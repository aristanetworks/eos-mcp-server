import { describe, expect, it, vi } from "vitest";
import { EapiDeviceReader } from "../src/connection/eosDeviceReader.js";
import { buildConfig, buildHost, setTestPasswordEnv } from "./helpers.js";

describe("EapiDeviceReader", () => {
  it("resolves the inventory host connection before delegating command intent", async () => {
    setTestPasswordEnv();
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show version", output_format: "json" as const, output: { version: "4.32.1F" } }
      ])
    };
    const reader = new EapiDeviceReader(
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      runner
    );

    const result = await reader.runShowCommands(
      buildHost({ inventoryHostname: "leaf1", resolvedEndpoint: "10.0.0.11" }),
      ["show version"],
      "json"
    );

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryHostname: "leaf1",
        endpointHost: "10.0.0.11",
        baseUrl: "https://10.0.0.11:443/command-api",
        username: "admin",
        password: "secret"
      }),
      ["show version"],
      "json",
      undefined
    );
    expect(result[0]?.output).toEqual({ version: "4.32.1F" });
  });
});
