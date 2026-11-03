import { describe, expect, it } from "vitest";
import { buildServerInfo } from "../src/serverInfo/buildServerInfo.js";
import { buildConfig } from "./helpers.js";

describe("buildServerInfo", () => {
  it("returns sanitized inventory basename and runtime mode", () => {
    const info = buildServerInfo({
      instanceId: "instance-1",
      startedAt: "2026-04-23T00:00:00.000Z",
      config: buildConfig({ inventoryPath: "/tmp/lab.yml" })
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
      config: buildConfig({ eapiVersion: 1 })
    });

    expect(info.capabilities.eapi_version).toBe(1);
  });

  it("reports packet capture limits under limits.diagnostics", () => {
    const info = buildServerInfo({ instanceId: "instance-1", startedAt: "2026-04-23T00:00:00.000Z", config: buildConfig() });

    expect(info.limits.diagnostics).toMatchObject({
      default_capture_packet_count: 10,
      max_capture_packet_count: 1000,
      default_capture_window_seconds: 10,
      max_capture_window_seconds: 60,
      max_capture_packets_per_request: 2000,
      capture_device_concurrency: 1,
      capture_overall_operation_timeout_ms: 90_000
    });
  });
});
