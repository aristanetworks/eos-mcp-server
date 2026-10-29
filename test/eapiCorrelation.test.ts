import { describe, expect, it, vi } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { buildConfig, buildInventoryModel, buildConnection } from "./helpers.js";

const result = [{ output: "" }, { output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n" }];
const call = { target: "leaf1", request: { kind: "ping" as const, destinations: ["127.0.0.1"] } };

describe("diagnostic completion response correlation", () => {
  it("keeps an attempt with an unrelated acknowledgement uncertain under its wire request ID", async () => {
    let sentId = "";
    const postJson = vi.fn(async (_connection, body: string) => {
      sentId = String(JSON.parse(body).id);
      return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: "other-attempt", result }), text: async () => "" };
    });
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const model = buildInventoryModel({ diagnosticsAllowed: true, effectiveVars: { ansible_user: "admin", ansible_password: "test-password" } });
    const executor = new DiagnosticExecutor(model, config, new EapiDiagnosticRunner(config, new EapiClient({ postJson })));
    expect((await executor.execute(call)).results[0]?.error_code).toBe("eapi_response_uncorrelated");
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 1, reservations: [{ reservation_id: sentId }] });
  });

  it("rejects contradictory success/error envelopes without treating them as completion", async () => {
    const postJson = vi.fn(async (_connection, body: string) => ({
      ok: true, status: 200,
      json: async () => ({ jsonrpc: "2.0", id: JSON.parse(body).id, result, error: null }),
      text: async () => ""
    }));
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({
      diagnosticsAllowed: true, effectiveVars: { ansible_user: "admin", ansible_password: "test-password" }
    }), config, new EapiDiagnosticRunner(config, new EapiClient({ postJson })));
    expect((await executor.execute(call)).results[0]?.error_code).toBe("eapi_payload_invalid");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
  });

  it("does not retry a show command on an uncorrelated JSON-output error", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ jsonrpc: "2.0", id: "another-request", error: { code: 1003, message: "Cannot convert to JSON" } }),
      text: async () => ""
    }));
    await expect(new EapiClient({ postJson }).runShowCommands(buildConnection(), ["show version"], "auto"))
      .rejects.toMatchObject({ code: "eapi_response_uncorrelated" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing ID", (id: string) => ({ jsonrpc: "2.0", result })],
    ["null ID", (id: string) => ({ jsonrpc: "2.0", id: null, result })],
    ["another request's ID", (id: string) => ({ jsonrpc: "2.0", id: "stale-request", result })],
    ["missing protocol version", (id: string) => ({ id, result })],
    ["wrong protocol version", (id: string) => ({ jsonrpc: "1.0", id, result })]
  ] as const)("does not treat a response with %s as completion", async (_label, payload) => {
    const postJson = vi.fn(async (_connection, body: string) => ({
      ok: true, status: 200,
      json: async () => payload(String(JSON.parse(body).id)),
      text: async () => ""
    }));
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({
      diagnosticsAllowed: true, effectiveVars: { ansible_user: "admin", ansible_password: "test-password" }
    }), config, new EapiDiagnosticRunner(config, new EapiClient({ postJson })));
    const response = await executor.execute(call);
    expect(response.results[0]).toMatchObject({ status: "failed", error_code: "eapi_response_uncorrelated" });
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    expect(postJson).toHaveBeenCalledTimes(1);
  });
});
