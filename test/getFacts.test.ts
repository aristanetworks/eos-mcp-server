import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { getFacts } from "../src/facts/getFacts.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("getFacts", () => {
  it("returns fixed-core facts for a group target", async () => {
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
        {
          command: "show version",
          output_format: "json",
          output: {
            hostname: "leaf1",
            modelName: "DCS-7050SX3-48YC8",
            version: "4.32.1F",
            serialNumber: "ABC123",
            systemMacAddress: "00:11:22:33:44:55",
            uptime: 12345
          }
        }
      ])
    };

    const result = await getFacts(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leafs", include_raw: false },
      runner
    );

    expect(result.summary.success_count).toBe(1);
    expect(result.results[0]?.facts?.device_hostname).toBe("leaf1");
    expect(result.results[0]?.facts?.model).toBe("DCS-7050SX3-48YC8");
    expect(result.results[0]?.facts?.eos_version).toBe("4.32.1F");
  });

  it("can include raw/debug payloads when requested", async () => {
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
    const rawEntry = { hostname: "leaf1", version: "4.32.1F" };
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show version", output_format: "json", output: rawEntry, raw_entry: rawEntry }
      ])
    };

    const result = await getFacts(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leafs", include_raw: true },
      runner
    );

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "json",
      expect.objectContaining({ includeRawEntries: true })
    );
    expect(result.results[0]?.command_results?.[0]?.raw_entry).toEqual(rawEntry);
  });

  it("excludes raw_entry by default when include_raw is omitted", async () => {
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
        { command: "show version", output_format: "json", output: { hostname: "leaf1" } }
      ])
    };

    const result = await getFacts(
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

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "json",
      expect.objectContaining({ includeRawEntries: undefined })
    );
    expect(result.results[0]?.command_results?.[0]?.raw_entry).toBeUndefined();
  });
});
