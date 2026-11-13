import { describe, expect, it, vi } from "vitest";
import type { ResolvedServerConfig } from "../src/config/schema.js";
import { AppError } from "../src/core/errors.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { runShow } from "../src/show/runShow.js";
import { buildConfig, mockRunShowCommands, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

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
      runShowCommands: mockRunShowCommands(async (_connection, commands, format) => {
        // A real reader resolves "auto" to the format it actually used; this fixture only echoes explicit formats.
        if (format === "auto") throw new Error("fixture expects an explicit output format");
        return commands.map((command) => ({ command, output_format: format, output: { command, format } }));
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
      runShowCommands: mockRunShowCommands(async () => [
        { command: "show version", output_format: "text", output: "EOS text output" }
      ])
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
    expect(runner.runShowCommands).toHaveBeenCalledTimes(1);
    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "auto",
      expect.objectContaining({ includeRawEntries: false })
    );
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
      runShowCommands: mockRunShowCommands(async () => {
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
      runShowCommands: mockRunShowCommands(async (_connection, commands) =>
        commands.map((command) => ({ command, output_format: "json", output: { command } }))
      )
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
      runShowCommands: mockRunShowCommands(async () => [
        {
          command: "show version",
          output_format: "json",
          output: { version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" }
        }
      ])
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
        output_format: "json",
        output: { version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" }
      }
    ]);
    expect(deviceResult.command_results?.[0]?.raw_entry).toBeUndefined();
  });

  it("fails a device result when eapi result count does not match commands", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: mockRunShowCommands(async () => {
        throw new AppError("eapi_payload_invalid", "Unexpected eAPI payload structure: expected 1 result entries but received 0");
      })
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
    expect(result.results[0]?.message).toMatch(/expected \d+ result entries/);
  });

  it("returns text output in normalized command_results", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: mockRunShowCommands(async () => [
        { command: "show version", output_format: "text", output: "Arista DCS-7050SX3-48YC8\n" }
      ])
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
        output_format: "text",
        output: "Arista DCS-7050SX3-48YC8\n"
      }
    ]);
  });

  it("attaches raw entries to command_results when include_raw is true", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const rawEntry = { version: "4.32.1F", modelName: "DCS-7050SX3-48YC8" };
    const runner = {
      runShowCommands: mockRunShowCommands(async () => [
        {
          command: "show version",
          output_format: "json",
          output: rawEntry,
          raw_entry: rawEntry
        }
      ])
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

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show version"],
      "json",
      expect.objectContaining({ includeRawEntries: true })
    );
    const deviceResult = result.results[0]!;
    expect(deviceResult.command_results?.[0]?.raw_entry).toEqual(rawEntry);
  });

  it("normalizes multiple command results in order", async () => {
    const { model, config } = await buildSingleHostRunShowFixture();
    const runner = {
      runShowCommands: mockRunShowCommands(async () => [
        { command: "show version", output_format: "json", output: { version: "4.32.1F" } },
        { command: "show hostname", output_format: "json", output: { hostname: "leaf1" } }
      ])
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
      { command: "show version", output_format: "json", output: { version: "4.32.1F" } },
      { command: "show hostname", output_format: "json", output: { hostname: "leaf1" } }
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
  describe("privileged show commands", () => {
    async function runWith(commands: string[], options: { outputFormat?: "auto" | "json" | "text"; configOverrides?: Partial<ResolvedServerConfig> } = {}) {
      const { model } = await buildSingleHostRunShowFixture();
      const config = buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" },
        ...options.configOverrides
      });
      const reader = {
        runShowCommands: mockRunShowCommands(async (_host, requestedCommands) =>
          requestedCommands.map((command) => ({ command, output_format: "text" as const, output: "ok" }))
        )
      };
      const run = runShow(model, config, { target: "leaf1", commands, outputFormat: options.outputFormat ?? "text" }, reader);
      const [result, error] = await run.then((value) => [value, undefined] as const, (caught: unknown) => [undefined, caught] as const);
      return { reader, result, error, readerOptions: reader.runShowCommands.mock.calls[0]?.[3] };
    }

    it.each([
      [["show event-monitor route limit 5", "show event-monitor arp limit 5"]],
      [["show event-monitor sqlite select * from route limit 3"]]
    ])("runs %j with enable and marks every result privileged", async (commands) => {
      const { result, readerOptions } = await runWith(commands);

      expect(readerOptions).toMatchObject({ enable: true });
      const commandResults = result?.results[0]?.command_results ?? [];
      expect(commandResults).toHaveLength(commands.length);
      for (const commandResult of commandResults) {
        expect(commandResult).toHaveProperty("privileged", true);
      }
    });

    it("requests text directly for privileged commands in auto mode", async () => {
      const { reader } = await runWith(["show event-monitor route limit 5"], { outputFormat: "auto" });
      expect(reader.runShowCommands.mock.calls[0]?.[2]).toBe("text");
    });

    it("omits enable and privileged for ordinary show commands", async () => {
      const { reader, result, readerOptions } = await runWith(["show version"], { outputFormat: "auto" });

      expect(reader.runShowCommands.mock.calls[0]?.[2]).toBe("auto");
      expect(readerOptions).not.toHaveProperty("enable");
      expect(result?.results[0]?.command_results?.[0]).not.toHaveProperty("privileged");
    });

    it("rejects mixed privileged and ordinary commands before contacting the device", async () => {
      const { reader, error } = await runWith(["show event-monitor route limit 5", "show version"]);
      expect(error).toMatchObject({ code: "show_command_privilege_mixed" });
      expect(reader.runShowCommands).not.toHaveBeenCalled();
    });

    it("does not treat abbreviated event-monitor commands as privileged", async () => {
      const { reader, error } = await runWith(["sh ev route"]);
      expect(error).toBeInstanceOf(AppError);
      expect(reader.runShowCommands).not.toHaveBeenCalled();
      const { readerOptions } = await runWith(["show ev route"]);
      expect(readerOptions).not.toHaveProperty("enable");
    });

    it("runs event-monitor unprivileged and allows mixing when privilegedShowCommands is empty", async () => {
      const configOverrides = { privilegedShowCommands: [] };
      const { readerOptions } = await runWith(["show event-monitor route"], { configOverrides });
      expect(readerOptions).not.toHaveProperty("enable");

      const { reader } = await runWith(["show event-monitor route", "show version"], { configOverrides });
      expect(reader.runShowCommands).toHaveBeenCalledTimes(1);
    });
  });
});
