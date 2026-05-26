import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildRunShowToolResult } from "../src/mcp/tools/runShow.js";
import { buildShowLoggingToolResult } from "../src/mcp/tools/showLogging.js";
import { buildGetFactsToolResult } from "../src/mcp/tools/getFacts.js";
import { buildGetRunningConfigToolResult } from "../src/mcp/tools/getRunningConfig.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("read MCP tool adapters", () => {
  it("buildRunShowToolResult returns structured content", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = {
      runShowCommands: vi.fn(async () => ({ result: [{ version: "4.32.1F" }] }))
    };

    const result = await buildRunShowToolResult(
      model,
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      {
        target: "leaf1",
        commands: ["show version"],
        output_format: "json",
        include_raw: false
      },
      runner
    );

    expect((result.structuredContent as { summary: { success_count: number } }).summary.success_count).toBe(1);
  });

  it("buildRunShowToolResult rejects when both command and commands are provided", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = { runShowCommands: vi.fn() };

    await expect(
      buildRunShowToolResult(
        model,
        buildConfig({
          defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
        }),
        {
          target: "leaf1",
          command: "show version",
          commands: ["show version"],
          output_format: "auto",
          include_raw: false
        },
        runner
      )
    ).rejects.toMatchObject({ code: "show_commands_input_invalid" });
    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("buildRunShowToolResult rejects when neither command nor commands are provided", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = { runShowCommands: vi.fn() };

    const promise = buildRunShowToolResult(
      model,
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      {
        target: "leaf1",
        output_format: "auto",
        include_raw: false
      },
      runner
    );

    await expect(promise).rejects.toMatchObject({ code: "show_commands_input_invalid" });
    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("buildShowLoggingToolResult returns structured content", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = {
      runShowCommands: vi.fn(async () => ({ result: [{ output: "warning log" }] }))
    };

    const result = await buildShowLoggingToolResult(
      model,
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      {
        target: "leaf1",
        minimum_severity: "warnings",
        message_count: 100
      },
      runner
    );

    expect((result.structuredContent as { summary: { success_count: number } }).summary.success_count).toBe(1);
  });

  it("buildGetFactsToolResult returns structured content", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = {
      runShowCommands: vi.fn(async () => ({
        result: [{ hostname: "leaf1", modelName: "DCS-7050", version: "4.32.1F" }]
      }))
    };

    const result = await buildGetFactsToolResult(
      model,
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      {
        target: "leaf1",
        include_raw: false
      },
      runner
    );

    expect((result.structuredContent as { summary: { success_count: number } }).summary.success_count).toBe(1);
  });

  it("buildGetRunningConfigToolResult returns structured content", async () => {
    setTestPasswordEnv();
    const model = await loadInventoryModel(
      await writeTempInventory([
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ])
    );

    const runner = {
      runShowCommands: vi.fn(async () => ({ result: [{ output: "hostname leaf1" }] }))
    };

    const result = await buildGetRunningConfigToolResult(
      model,
      buildConfig({
        defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
      }),
      {
        target: "leaf1"
      },
      runner
    );

    expect((result.structuredContent as { summary: { success_count: number } }).summary.success_count).toBe(1);
  });
});
