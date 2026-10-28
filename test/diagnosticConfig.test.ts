import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadServerConfig } from "../src/config/loadConfig.js";
import { writeTempInventory } from "./helpers.js";

async function load(lines: string[]) {
  return loadServerConfig({ command: "serve", configPath: await writeTempInventory(lines, "eos-diagnostics-config-") });
}

describe("diagnostic settings", () => {
  it("resolves the durable state file relative to the settings file", async () => {
    const config = await load(["diagnostics:", "  stateFile: ./private/diagnostics.sqlite"]);
    expect(config.diagnostics.stateFile).toBe(path.join(path.dirname(config.configPath ?? ""), "private/diagnostics.sqlite"));
  });

  it("supplies finite defaults without a settings file", async () => {
    const config = await loadServerConfig({ command: "serve" });
    expect(config.diagnostics).toEqual({
      defaultPingCount: 3, maxPingCount: 10, maxProbesPerRequest: 100, deviceConcurrency: 5,
      pingReplyTimeoutMs: 1000, commandTimeoutMs: 30_000, httpTimeoutMs: 35_000, overallOperationTimeoutMs: 60_000
    });
  });

  it("merges partial settings with diagnostic defaults", async () => {
    const config = await load(["diagnostics:", "  defaultPingCount: 2", "  deviceConcurrency: 1"]);
    expect(config.diagnostics.defaultPingCount).toBe(2);
    expect(config.diagnostics.deviceConcurrency).toBe(1);
    expect(config.diagnostics.httpTimeoutMs).toBe(35_000);
  });

  it("loads every limit and timeout from YAML", async () => {
    const config = await load([
      "diagnostics:", "  defaultPingCount: 4", "  maxPingCount: 20", "  maxProbesPerRequest: 200", "  deviceConcurrency: 2",
      "  pingReplyTimeoutMs: 2000", "  commandTimeoutMs: 65000", "  httpTimeoutMs: 70000", "  overallOperationTimeoutMs: 90000"
    ]);
    expect(config.diagnostics).toEqual({ defaultPingCount: 4, maxPingCount: 20, maxProbesPerRequest: 200, deviceConcurrency: 2,
      pingReplyTimeoutMs: 2000, commandTimeoutMs: 65000, httpTimeoutMs: 70000, overallOperationTimeoutMs: 90000 });
  });

  it("validates HTTP timeouts independently rather than inventing a combined release timer", async () => {
    const config = await load(["diagnostics:", "  httpTimeoutMs: 2147483647"]);
    expect(config.diagnostics.httpTimeoutMs).toBe(2_147_483_647);
  });

  it.each([
    "defaultPingCount: 11", "maxProbesPerRequest: 5", "commandTimeoutMs: 5000", "httpTimeoutMs: 10000",
    "deviceConcurrency: 0", "maxPingCount: -1", "pingReplyTimeoutMs: 1500", "overallOperationTimeoutMs: 0",
    "httpTimeoutMs: 2147483648", "deviceConcurrency: true", "unknownLimit: 5", "maxPingCount: .inf"
  ])("rejects unsafe or contradictory settings: %s", async (line) => {
    await expect(load(["diagnostics:", `  ${line}`])).rejects.toMatchObject({ code: "config_schema_invalid" });
  });
});
