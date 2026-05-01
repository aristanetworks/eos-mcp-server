import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveEapiConnection } from "../src/connection/resolveConnection.js";
import { EapiClient } from "../src/eapi/client.js";
import { FetchEapiTransport } from "../src/eapi/transport.js";
import { buildConfig, buildHost, setTestPasswordEnv } from "./helpers.js";

describe("resolveEapiConnection", () => {
  it("uses server default username and password env when host does not override them", () => {
    setTestPasswordEnv("topsecret");

    const connection = resolveEapiConnection(
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          ansibleHttpapiPort: 8443,
          mcpValidateCerts: true,
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      buildHost({
        inventoryHostname: "leaf1",
        resolvedEndpoint: "10.0.0.11",
        effectiveVars: {}
      })
    );

    expect(connection.baseUrl).toBe("https://10.0.0.11:8443/command-api");
    expect(connection.username).toBe("admin");
    expect(connection.password).toBe("topsecret");
    expect(connection.validateCerts).toBe(true);
  });

  it("allows host-specific username override", () => {
    setTestPasswordEnv("topsecret");

    const connection = resolveEapiConnection(
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      buildHost({
        effectiveVars: {
          ansible_user: "operator"
        }
      })
    );

    expect(connection.username).toBe("operator");
  });

  it("rejects multiple effective password sources", () => {
    setTestPasswordEnv("topsecret");

    expect(() =>
      resolveEapiConnection(
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        buildHost({
          effectiveVars: {
            ansible_password: "literal-secret"
          }
        })
      )
    ).toThrow(/password/i);
  });

  it("respects ansible_httpapi_validate_certs when mcp_validate_certs is absent", () => {
    setTestPasswordEnv("topsecret");

    const connection = resolveEapiConnection(
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      buildHost({
        effectiveVars: {
          ansible_httpapi_validate_certs: false
        }
      })
    );

    expect(connection.validateCerts).toBe(false);
  });

  it("prefers mcp_validate_certs over ansible_httpapi_validate_certs", () => {
    setTestPasswordEnv("topsecret");

    const connection = resolveEapiConnection(
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      buildHost({
        effectiveVars: {
          mcp_validate_certs: true,
          ansible_httpapi_validate_certs: false
        }
      })
    );

    expect(connection.validateCerts).toBe(true);
  });

  it("rejects disallowed password env prefixes", () => {
    process.env.BAD_PASSWORD = "secret";

    expect(() =>
      resolveEapiConnection(
        buildConfig({
          secretEnvPrefixes: ["EOS_MCP_"],
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "BAD_PASSWORD"
          }
        }),
        buildHost()
      )
    ).toThrow(/prefix/i);
  });
});

describe("EapiClient", () => {
  it("sends runCmds requests to the command-api endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: [{ version: "4.32.1F" }] }),
      text: async () => JSON.stringify({ result: [{ version: "4.32.1F" }] })
    }));

    const client = new EapiClient(new FetchEapiTransport(fetchMock));
    const connection = {
      inventoryHostname: "leaf1",
      endpointHost: "10.0.0.11",
      baseUrl: "https://10.0.0.11:443/command-api",
      username: "admin",
      password: "secret",
      validateCerts: true,
      caFile: undefined,
      timeoutMs: 10_000
    };

    await client.runShowCommands(connection, ["show version"], "json");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://10.0.0.11:443/command-api");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json"
    });
    expect(String((init?.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);

    const body = JSON.parse(String(init?.body));
    expect(body.method).toBe("runCmds");
    expect(body.params.cmds).toEqual(["show version"]);
    expect(body.params.format).toBe("json");
  });

  it("throws when EOS returns a JSON-RPC error payload", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { code: 1002, message: "CLI command failed", data: ["bad command"] } }),
      text: async () => JSON.stringify({ error: { code: 1002, message: "CLI command failed" } })
    }));

    const client = new EapiClient(new FetchEapiTransport(fetchMock));
    const connection = {
      inventoryHostname: "leaf1",
      endpointHost: "10.0.0.11",
      baseUrl: "https://10.0.0.11:443/command-api",
      username: "admin",
      password: "secret",
      validateCerts: true,
      caFile: undefined,
      timeoutMs: 10_000
    };

    await expect(client.runShowCommands(connection, ["show version"], "json")).rejects.toThrow(/JSON-RPC error 1002/);
  });

  it("uses Node HTTPS options for TLS validation and caches custom CA contents", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eos-mcp-ca-"));
    const caFile = path.join(dir, "ca.pem");
    await fs.writeFile(caFile, "test-ca");

    const readFileSpy = vi.spyOn(fs, "readFile");
    let capturedOptions: https.RequestOptions | undefined;
    const requestSpy = vi.spyOn(https, "request").mockImplementation((_url, options, callback) => {
      capturedOptions = options as https.RequestOptions;
      const request = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: () => void;
        destroy: ReturnType<typeof vi.fn>;
      };
      request.write = vi.fn();
      request.destroy = vi.fn();
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = 200;
        callback?.(response);
        response.emit("data", Buffer.from(JSON.stringify({ result: [{ version: "4.32.1F" }] })));
        response.emit("end");
      };
      return request as unknown as ReturnType<typeof https.request>;
    });

    try {
      const client = new EapiClient();
      const connection = {
        inventoryHostname: "leaf1",
        endpointHost: "10.0.0.11",
        baseUrl: "https://10.0.0.11:443/command-api",
        username: "admin",
        password: "secret",
        validateCerts: false,
        caFile,
        timeoutMs: 10_000
      };

      await client.runShowCommands(connection, ["show version"], "json");
      await client.runShowCommands(connection, ["show hostname"], "json");

      expect(capturedOptions?.rejectUnauthorized).toBe(false);
      expect(capturedOptions?.ca).toBe("test-ca");
      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy).toHaveBeenCalledWith(caFile, "utf8");
    } finally {
      readFileSpy.mockRestore();
      requestSpy.mockRestore();
    }
  });
});
