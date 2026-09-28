import { describe, expect, it } from "vitest";
import { buildServerInfo } from "../src/serverInfo/buildServerInfo.js";
import { buildConfig } from "./helpers.js";

describe("buildServerInfo", () => {
  it("returns sanitized inventory basename and runtime mode", () => {
    const info = buildServerInfo({
      instanceId: "instance-1",
      startedAt: "2026-04-23T00:00:00.000Z",
      config: buildConfig({ inventoryPath: "/tmp/lab.yml" }),
      inventorySummary: undefined
    });

    expect(info.runtime_mode).toBe("read-only");
    expect(info.inventory.basename).toBe("lab.yml");
    expect(info.capabilities.tool_prefix).toBe("eos_");
    expect(info.limits.max_logging_messages_per_request).toBe(1000);
  });

  it("reports the configured eAPI output version", () => {
    const info = buildServerInfo({
      instanceId: "instance-1",
      startedAt: "2026-04-23T00:00:00.000Z",
      config: buildConfig({ eapiVersion: 1 }),
      inventorySummary: undefined
    });

    expect(info.capabilities.eapi_version).toBe(1);
  });
});
