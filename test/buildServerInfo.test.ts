import { describe, expect, it } from "vitest";
import { buildServerInfo } from "../src/serverInfo/buildServerInfo.js";

describe("buildServerInfo", () => {
  it("returns sanitized inventory basename and runtime mode", () => {
    const info = buildServerInfo({
      instanceId: "instance-1",
      startedAt: "2026-04-23T00:00:00.000Z",
      writePathStatus: "idle",
      config: {
        configPath: undefined,
        inventoryPath: "/tmp/lab.yml",
        enableWrite: false,
        allowDirectConfigFallback: false,
        actor: undefined,
        logFile: undefined,
        caFile: undefined,
        readTimeoutMs: 10_000,
        writeTimeoutMs: 30_000,
        overallOperationTimeoutMs: undefined,
        deviceConcurrency: 5,
        maxReadTargets: 50,
        maxWriteTargets: 10,
        maxShowCommandsPerRequest: 5,
        maxLoggingMessagesPerRequest: 1000,
        maxConfigCommandsPerRequest: 20,
        maxResponseSizeBytes: 1_048_576,
        previewMaxAgeMs: 900_000,
        logWriteCommands: false,
        secretEnvPrefixes: ["EOS_MCP_"],
        defaultConnection: {}
      },
      inventorySummary: undefined
    });

    expect(info.runtime_mode).toBe("read-only");
    expect(info.inventory.basename).toBe("lab.yml");
    expect(info.capabilities.tool_prefix).toBe("eos_");
    expect(info.limits.max_logging_messages_per_request).toBe(1000);
    expect(info).not.toHaveProperty("write_path_status");
    expect(info.inventory).not.toHaveProperty("write_allowed_hosts");
    expect(info.capabilities).not.toHaveProperty("write_enabled");
    expect(info.capabilities).not.toHaveProperty("direct_config_fallback_enabled");
    expect(info.limits).not.toHaveProperty("write_timeout_ms");
    expect(info.limits).not.toHaveProperty("max_write_targets");
    expect(info.limits).not.toHaveProperty("max_config_commands_per_request");
    expect(info.limits).not.toHaveProperty("preview_max_age_ms");
    expect(info.logging).not.toHaveProperty("log_write_commands");
  });
});
