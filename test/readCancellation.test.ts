import { describe, expect, it } from "vitest";
import { EapiDeviceReader } from "../src/connection/eosDeviceReader.js";
import { AppError } from "../src/core/errors.js";
import { buildGetFactsToolResult } from "../src/mcp/tools/getFacts.js";
import { buildGetRunningConfigToolResult } from "../src/mcp/tools/getRunningConfig.js";
import { buildProbeDevicesToolResult } from "../src/mcp/tools/probeDevices.js";
import { buildRunShowToolResult } from "../src/mcp/tools/runShow.js";
import { buildShowLoggingToolResult } from "../src/mcp/tools/showLogging.js";
import { runShow } from "../src/show/runShow.js";
import {
  buildConfig,
  buildEapiSlots,
  buildInventoryModel,
  controlledReadRunner,
  mockRunShowCommands,
  setTestPasswordEnv
} from "./helpers.js";

const connectionDefaults = { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" };

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met in time");
}

describe("read cancellation through the shared eAPI slots", () => {
  it("rejects a queued eos_run_show on abort, never dispatches it, and frees its queue position", async () => {
    setTestPasswordEnv();
    const config = buildConfig({ deviceConcurrency: 1, defaultConnection: connectionDefaults });
    const slots = buildEapiSlots(config);
    const { runner, dispatched } = controlledReadRunner();
    const reader = new EapiDeviceReader(config, runner, slots);
    const model = buildInventoryModel();
    const showVersionOptions = { target: "leaf1", commands: ["show version"], outputFormat: "json" as const };

    const slotHolder = runShow(model, config, showVersionOptions, reader);
    await waitForCondition(() => dispatched.length === 1);

    const callerAbort = new AbortController();
    const cancelledReadOutcome = runShow(model, config, showVersionOptions, reader, callerAbort.signal).then(
      () => undefined,
      (error: unknown) => error
    );
    await waitForCondition(() => slots.snapshot().devices.some((device) => device.read_queued_count === 1));

    callerAbort.abort();
    const cancellationError = await cancelledReadOutcome;
    expect(cancellationError).toBeInstanceOf(AppError);
    expect((cancellationError as AppError).code).toBe("operation_aborted");
    expect(slots.snapshot().devices.every((device) => device.read_queued_count === 0)).toBe(true);

    const laterRead = runShow(model, config, showVersionOptions, reader);
    dispatched[0]?.settle();
    await slotHolder;
    await waitForCondition(() => dispatched.length === 2);
    dispatched[1]?.settle();
    await laterRead;

    expect(dispatched).toHaveLength(2);
  });

  describe("tool builders forward the caller signal", () => {
    const model = buildInventoryModel();
    const config = buildConfig();
    const alreadyAborted = AbortSignal.abort();

    function neverCalledReader() {
      return { runShowCommands: mockRunShowCommands(async () => []) };
    }

    const builders: Array<[string, (reader: ReturnType<typeof neverCalledReader>) => Promise<unknown>]> = [
      ["eos_probe_devices", (reader) =>
        buildProbeDevicesToolResult(model, config, { target: "leaf1", include_raw: false }, reader, alreadyAborted)],
      ["eos_run_show", (reader) =>
        buildRunShowToolResult(model, config, { target: "leaf1", command: "show version", output_format: "auto", include_raw: false }, reader, alreadyAborted)],
      ["eos_show_logging", (reader) =>
        buildShowLoggingToolResult(model, config, { target: "leaf1", minimum_severity: "warnings", message_count: 100 }, reader, alreadyAborted)],
      ["eos_get_facts", (reader) =>
        buildGetFactsToolResult(model, config, { target: "leaf1", include_raw: false }, reader, alreadyAborted)],
      ["eos_get_running_config", (reader) =>
        buildGetRunningConfigToolResult(model, config, { target: "leaf1" }, reader, alreadyAborted)]
    ];

    it.each(builders)("%s rejects as cancelled without reaching the device reader", async (_toolName, invokeBuilder) => {
      const reader = neverCalledReader();
      await expect(invokeBuilder(reader)).rejects.toMatchObject({ code: "operation_aborted" });
      expect(reader.runShowCommands).not.toHaveBeenCalled();
    });
  });
});
