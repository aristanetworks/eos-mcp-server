import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildProbeDevicesToolResult } from "../src/mcp/tools/probeDevices.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("buildProbeDevicesToolResult", () => {
  it("returns structured probe results", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "groups:",
      "  leafs:",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show version", output_format: "json", output: { version: "4.32.1F" } }
      ])
    };

    const result = await buildProbeDevicesToolResult(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leafs" },
      runner
    );

    const payload = result.structuredContent as {
      summary: { success_count: number };
    };

    expect(payload.summary.success_count).toBe(1);
    expect(result.content[0]?.type).toBe("text");
  });
});
