import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { runShow } from "../src/show/runShow.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("runShow", () => {
  it("runs show commands against a group target", async () => {
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
      runShowCommands: vi.fn(async (_connection, commands, format) => ({
        result: commands.map((command) => ({ command, format }))
      }))
    };

    const result = await runShow(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      {
        target: "leafs",
        commands: ["show version"],
        outputFormat: "json"
      },
      runner
    );

    expect(result.summary.success_count).toBe(2);
    expect(result.results[0]?.actual_output_format).toBe("json");
  });

  it("auto mode falls back from json to text", async () => {
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
      runShowCommands: vi
        .fn()
        .mockRejectedValueOnce(new AppError("json_output_unavailable", "json output unavailable"))
        .mockResolvedValueOnce({ result: [{ output: "EOS text output" }] })
    };

    const result = await runShow(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      {
        target: "leafs",
        commands: ["show version"],
        outputFormat: "auto"
      },
      runner
    );

    expect(result.results[0]?.actual_output_format).toBe("text");
    expect(runner.runShowCommands).toHaveBeenCalledTimes(2);
  });

  it("explicit json mode fails when json output is unavailable", async () => {
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
        throw new AppError("json_output_unavailable", "json output unavailable");
      })
    };

    const result = await runShow(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      {
        target: "leafs",
        commands: ["show version"],
        outputFormat: "json"
      },
      runner
    );

    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error_code).toBe("json_output_unavailable");
  });

  it("rejects non-show commands before device contact", async () => {
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
      runShowCommands: vi.fn()
    };

    await expect(
      runShow(
        model,
        buildConfig({
          defaultConnection: {
            ansibleUser: "admin",
            mcpPasswordEnv: "EOS_MCP_PASSWORD"
          }
        }),
        {
          target: "leafs",
          commands: ["reload now"],
          outputFormat: "auto"
        },
        runner
      )
    ).rejects.toThrow(/show/i);

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("enforces configured read target and show command limits", async () => {
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
    const config = buildConfig({
      maxReadTargets: 1,
      maxShowCommandsPerRequest: 1,
      defaultConnection: {
        ansibleUser: "admin",
        mcpPasswordEnv: "EOS_MCP_PASSWORD"
      }
    });
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      runShow(
        model,
        config,
        {
          target: "leafs",
          commands: ["show version"],
          outputFormat: "json"
        },
        runner
      )
    ).rejects.toThrow(/maxReadTargets/);

    await expect(
      runShow(
        model,
        { ...config, maxReadTargets: 10 },
        {
          target: "leaf1",
          commands: ["show version", "show hostname"],
          outputFormat: "json"
        },
        runner
      )
    ).rejects.toThrow(/maxShowCommandsPerRequest/);
  });
});
