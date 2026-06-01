import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { probeDevices } from "../src/probe/probeDevices.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("probeDevices", () => {
  it("probes a group and returns per-device success results", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "groups:",
      "  leafs:",
      "    hosts: [leaf1, leaf2]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "  leaf2:",
      "    ansible_host: 10.0.0.12"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn(async (_connection, commands, format) => [
        { command: commands[0], output_format: format, output: { version: "4.32.1F", commands, format } }
      ])
    };

    const result = await probeDevices(
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

    expect(result.target).toBe("leafs");
    expect(result.summary.success_count).toBe(2);
    expect(result.results.map((entry) => entry.inventory_hostname)).toEqual(["leaf1", "leaf2"]);
    expect(runner.runShowCommands).toHaveBeenCalledTimes(2);
  });

  it("surfaces runtime failures per device", async () => {
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
      runShowCommands: vi.fn(async () => {
        throw new Error("authentication failed");
      })
    };

    const result = await probeDevices(
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

    expect(result.summary.failed_count).toBe(1);
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error_code).toBe("probe_failed");
  });

  it("excludes command_results when include_raw is false", async () => {
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

    const result = await probeDevices(
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
    expect(result.results[0]?.status).toBe("success");
    expect(result.results[0]?.command_results).toBeUndefined();
  });

  it("includes raw entries in command_results when include_raw is true", async () => {
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
    const rawEntry = { version: "4.32.1F" };
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show version", output_format: "json", output: rawEntry, raw_entry: rawEntry }
      ])
    };

    const result = await probeDevices(
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

    expect(result.summary.success_count).toBe(1);
    expect(result.results[0]?.status).toBe("success");
    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "json",
      expect.objectContaining({ includeRawEntries: true })
    );
    expect(result.results[0]?.command_results?.[0]?.raw_entry).toEqual(rawEntry);
  });

  it("rejects read-denied targets before device contact", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "groups:",
      "  denied:",
      "    vars:",
      "      mcp_read_allowed: false",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      probeDevices(
        model,
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        { target: "denied", include_raw: false },
        runner
      )
    ).rejects.toThrow(/policy/i);

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });
});
