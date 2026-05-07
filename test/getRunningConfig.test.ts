import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { getRunningConfig } from "../src/configuration/getRunningConfig.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("getRunningConfig", () => {
  it("returns full config for a single host target", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn(async (_connection, commands) => ({
        result: [{ output: `ran ${commands[0]}` }]
      }))
    };

    const result = await getRunningConfig(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leaf1" },
      runner
    );

    expect(result.summary.success_count).toBe(1);
    expect(result.results[0]?.config_text).toContain("show running-config");
  });

  it("requires a section for group targets", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "groups:",
      "  leafs:",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);

    await expect(
      getRunningConfig(
        model,
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        { target: "leafs" },
        { runShowCommands: vi.fn() }
      )
    ).rejects.toThrow(/section/i);
  });

  it("passes enable option to the runner", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn(async (_connection: unknown, _commands: unknown, _format: unknown, _options: unknown) => ({
        result: [{ output: "! running-config\n" }]
      }))
    };

    await getRunningConfig(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leaf1" },
      runner
    );

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show running-config"],
      "text",
      expect.objectContaining({ enable: true })
    );
  });

  it("uses section commands for group targets", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "groups:",
      "  leafs:",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = {
      runShowCommands: vi.fn(async (_connection, commands) => ({
        result: [{ output: `ran ${commands[0]}` }]
      }))
    };

    const result = await getRunningConfig(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { target: "leafs", section: "interface Ethernet1" },
      runner
    );

    expect(result.results[0]?.config_text).toContain("section interface Ethernet1");
  });

  it("rejects multiline section input before device contact", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = { runShowCommands: vi.fn() };

    await expect(
      getRunningConfig(
        model,
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        { target: "leaf1", section: "interface Ethernet1\nshow version" },
        runner
      )
    ).rejects.toThrow(/single line/i);

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("rejects risky section modifiers before device contact", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const runner = { runShowCommands: vi.fn() };

    await expect(
      getRunningConfig(
        model,
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        { target: "leaf1", section: "interface Ethernet1 | redirect flash:cfg.txt" },
        runner
      )
    ).rejects.toMatchObject({ code: "eos_input_invalid" });

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });
});
