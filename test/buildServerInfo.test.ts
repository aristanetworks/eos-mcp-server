import { describe, expect, it } from "vitest";
import { buildServerInfo } from "../src/serverInfo/buildServerInfo.js";

describe("buildServerInfo", () => {
  it("returns sanitized inventory basename and runtime mode", () => {
    const info = buildServerInfo({
      instanceId: "instance-1",
      startedAt: "2026-04-23T00:00:00.000Z",
      config: {
        configPath: undefined,
        inventoryPath: "/tmp/lab.yml",
        actor: undefined,
        logFile: undefined,
        caFile: undefined,
        readTimeoutMs: 10_000,
        overallOperationTimeoutMs: undefined,
        deviceConcurrency: 5,
        maxReadTargets: 50,
        maxShowCommandsPerRequest: 5,
        maxLoggingMessagesPerRequest: 1000,
        maxResponseSizeBytes: 1_048_576,
        secretEnvPrefixes: ["EOS_MCP_"],
        defaultConnection: {}
      },
      inventorySummary: undefined
    });

    expect(info.runtime_mode).toBe("read-only");
    expect(info.inventory.basename).toBe("lab.yml");
    expect(info.capabilities.tool_prefix).toBe("eos_");
    expect(info.limits.max_logging_messages_per_request).toBe(1000);
  });
});
