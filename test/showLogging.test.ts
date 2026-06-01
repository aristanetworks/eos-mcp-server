import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { showLogging } from "../src/logging/showLogging.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

async function buildSingleHostShowLoggingFixture() {
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
    config: buildConfig({
      defaultConnection: {
        ansibleUser: "admin",
        mcpPasswordEnv: "EOS_MCP_PASSWORD"
      }
    })
  };
}

describe("showLogging", () => {
  it("runs a bounded threshold logging command with defaults", async () => {
    const { model, config } = await buildSingleHostShowLoggingFixture();
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show logging threshold warnings 100", output_format: "text", output: "Nov 1 leaf1 Event\n" }
      ])
    };

    const result = await showLogging(
      model,
      config,
      {
        target: "leaf1"
      },
      runner
    );

    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show logging threshold warnings 100"],
      "text",
      expect.objectContaining({})
    );
    expect(result.minimum_severity).toBe("warnings");
    expect(result.message_count).toBe(100);
    expect(result.results[0]).toMatchObject({
      status: "success",
      command: "show logging threshold warnings 100",
      log_text: "Nov 1 leaf1 Event\n"
    });
  });

  it("uses explicit severity and message count for group targets", async () => {
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
      runShowCommands: vi.fn(async () => [
        { command: "show logging threshold errors 50", output_format: "text", output: "error log\n" }
      ])
    };

    const result = await showLogging(
      model,
      buildConfig({
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      {
        target: "leafs",
        minimumSeverity: "errors",
        messageCount: 50
      },
      runner
    );

    expect(result.summary.success_count).toBe(2);
    expect(result.minimum_severity).toBe("errors");
    expect(result.message_count).toBe(50);
    expect(runner.runShowCommands).toHaveBeenCalledWith(
      expect.anything(),
      ["show logging threshold errors 50"],
      "text",
      expect.objectContaining({})
    );
  });

  it("rejects message counts above the configured logging limit before device contact", async () => {
    const { model, config } = await buildSingleHostShowLoggingFixture();
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      showLogging(
        model,
        { ...config, maxLoggingMessagesPerRequest: 25 },
        {
          target: "leaf1",
          messageCount: 26
        },
        runner
      )
    ).rejects.toMatchObject({ code: "logging_message_count_limit_exceeded" });

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("rejects unsupported severities before device contact", async () => {
    const { model, config } = await buildSingleHostShowLoggingFixture();
    const runner = {
      runShowCommands: vi.fn()
    };

    await expect(
      showLogging(
        model,
        config,
        {
          target: "leaf1",
          minimumSeverity: "warning" as never
        },
        runner
      )
    ).rejects.toMatchObject({ code: "logging_severity_invalid" });

    expect(runner.runShowCommands).not.toHaveBeenCalled();
  });

  it("fails a device result when the logging payload is not text output", async () => {
    const { model, config } = await buildSingleHostShowLoggingFixture();
    const runner = {
      runShowCommands: vi.fn(async () => [
        { command: "show logging threshold warnings 100", output_format: "json", output: { entries: [] } }
      ])
    };

    const result = await showLogging(
      model,
      config,
      {
        target: "leaf1"
      },
      runner
    );

    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error_code).toBe("logging_payload_invalid");
  });
});
