import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { runShow } from "../src/show/runShow.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

function defaultReadConfig() {
  return buildConfig({
    defaultConnection: {
      ansibleUser: "admin",
      mcpPasswordEnv: "EOS_MCP_PASSWORD"
    }
  });
}

async function buildSingleHostRunShowFixture() {
  setTestPasswordEnv();
  const inventoryPath = await writeTempInventory([
    "vars:",
    "  ansible_network_os: eos",
    "hosts:",
    "  leaf1:",
    "    ansible_host: 10.0.0.11"
  ]);

  return {
    model: await loadInventoryModel(inventoryPath),
    config: defaultReadConfig()
  };
}

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

  it("rejects multiline show commands before device contact", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      runShow(
        model,
        config,
        {
          target: "leaf1",
          commands: ["show version\nconfigure terminal"],
          outputFormat: "auto"
        },
        runner
      )
    ).rejects.toThrow(/single line/i);

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("rejects show commands with risky output modifiers before device contact", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      runShow(
        model,
        config,
        {
          target: "leaf1",
          commands: ["show version | redirect flash:version.txt"],
          outputFormat: "auto"
        },
        runner
      )
    ).rejects.toMatchObject({ code: "eos_input_invalid" });

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("trims commands before dispatch", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn(async (_connection, commands) => ({
        result: commands.map((command) => ({ command }))
      }))
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["  show version  "],
        outputFormat: "json"
      },
      runner
    );

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "json",
      expect.objectContaining({})
    );
    expect(result.results[0]?.command_results?.[0]?.command).toBe("show version");
  });

  it("returns normalized command_results by default", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn(async () => ({
        result: [{ version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" }]
      }))
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["show version"],
        outputFormat: "json"
      },
      runner
    );

    const deviceResult = result.results[0]!;
    expect(deviceResult.command_results).toEqual([
      {
        command: "show version",
        output: { version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" }
      }
    ]);
    expect(deviceResult.raw_result).toBeUndefined();
  });

  it("fails a device result when eapi result count does not match commands", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn(async () => ({
        result: []
      }))
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["show version"],
        outputFormat: "json"
      },
      runner
    );

    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error_code).toBe("eapi_payload_invalid");
    expect(result.results[0]?.message).toContain("expected 1 result entries");
  });

  it("returns text output in normalized command_results", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn(async () => ({
        result: [{ output: "Arista DCS-7050SX3-48YC8\n" }]
      }))
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["show version"],
        outputFormat: "text"
      },
      runner
    );

    const deviceResult = result.results[0]!;
    expect(deviceResult.command_results).toEqual([
      {
        command: "show version",
        output: "Arista DCS-7050SX3-48YC8\n"
      }
    ]);
  });

  it("includes raw_result when include_raw is true", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const eapiPayload = {
      result: [{ version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" }]
    };
    const runner = {
      runShowCommands: vi.fn(async () => eapiPayload)
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["show version"],
        outputFormat: "json",
        includeRaw: true
      },
      runner
    );

    const deviceResult = result.results[0]!;
    expect(deviceResult.raw_result).toEqual(eapiPayload);
  });

  it("normalizes multiple command results in order", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: vi.fn(async () => ({
        result: [
          { version: "4.32.1F" },
          { hostname: "leaf1" }
        ]
      }))
    };

    const result = await runShow(
      model,
      config,
      {
        target: "leaf1",
        commands: ["show version", "show hostname"],
        outputFormat: "json"
      },
      runner
    );

    const deviceResult = result.results[0]!;
    expect(deviceResult.command_results).toEqual([
      { command: "show version", output: { version: "4.32.1F" } },
      { command: "show hostname", output: { hostname: "leaf1" } }
    ]);
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
