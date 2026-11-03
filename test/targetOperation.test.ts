import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import type { InventoryHostModel } from "../src/inventory/types.js";
import {
  buildDeviceSuccess,
  readOperationLimits,
  runTargetOperation,
  type DeviceResultBase,
  type TargetOperationOptions
} from "../src/operations/targetOperation.js";
import { buildConfig, buildInventoryModel, loadSwitchesModel } from "./helpers.js";

type Entry = DeviceResultBase & { note?: string };

/** Options that run one successful entry per host, with `overrides` applied. */
function options(overrides: Partial<TargetOperationOptions<Entry, Record<string, unknown>>> = {}): TargetOperationOptions<Entry, Record<string, unknown>> {
  return {
    target: "switches",
    operationName: "eos_test",
    concurrency: 10,
    run: async (host) => [buildDeviceSuccess(host, { note: "ran" })],
    failureCode: "test_failed",
    ...overrides
  };
}

afterEach(() => vi.useRealTimers());

describe("runTargetOperation", () => {
  it("returns every host's entries in host order, counts each entry, and merges extra fields", async () => {
    const run = vi.fn(async (host: InventoryHostModel): Promise<Entry[]> => [
      buildDeviceSuccess(host, { note: "first" }),
      { ...buildDeviceSuccess(host, {}), status: "failed", error_code: "test_partial", message: "second failed" }
    ]);
    const response = await runTargetOperation(await loadSwitchesModel(), buildConfig(), options({ run, extra: { echoed: true } }));
    expect(response).toMatchObject({
      target: "switches",
      target_type: "group",
      echoed: true,
      summary: { total_count: 4, success_count: 2, failed_count: 2 }
    });
    expect(response.results.map((entry) => entry.inventory_hostname)).toEqual(
      response.resolved_devices.flatMap((hostname) => [hostname, hostname])
    );
  });

  it("turns a throwing host into that host's failed entry, keeping an AppError's own code over the fallback", async () => {
    const response = await runTargetOperation(await loadSwitchesModel(), buildConfig(), options({
      run: async (host) => {
        if (host.inventoryHostname === "leaf1") throw new AppError("eapi_transport_error", "Lost connection");
        throw new Error("plain failure");
      }
    }));
    expect(response.summary).toEqual({ total_count: 2, success_count: 0, failed_count: 2 });
    expect(response.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ inventory_hostname: "leaf1", status: "failed", error_code: "eapi_transport_error", message: "Lost connection" }),
      expect.objectContaining({ inventory_hostname: "leaf2", status: "failed", error_code: "test_failed", message: "plain failure" })
    ]));
  });

  it("rejects a Target over maxReadTargets before contacting any host", async () => {
    const run = vi.fn(async (): Promise<Entry[]> => []);
    await expect(runTargetOperation(await loadSwitchesModel(), buildConfig({ maxReadTargets: 1 }), options({ run })))
      .rejects.toMatchObject({ code: "read_target_limit_exceeded" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects the whole call when validateTarget throws, before contacting any host", async () => {
    const run = vi.fn(async (): Promise<Entry[]> => []);
    const validateTarget = vi.fn(() => { throw new AppError("test_option_required", "Group targets need an option"); });
    await expect(runTargetOperation(await loadSwitchesModel(), buildConfig(), options({ run, validateTarget })))
      .rejects.toMatchObject({ code: "test_option_required" });
    expect(validateTarget).toHaveBeenCalledWith(expect.objectContaining({ targetType: "group" }));
    expect(run).not.toHaveBeenCalled();
  });

  it("contacts at most `concurrency` hosts at once", async () => {
    const releases: Array<() => void> = [];
    const run = vi.fn((host: InventoryHostModel) => new Promise<Entry[]>((resolve) => {
      releases.push(() => resolve([buildDeviceSuccess(host, {})]));
    }));
    const pending = runTargetOperation(await loadSwitchesModel(), buildConfig(), options({ run, concurrency: 1 }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    releases[0]?.();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    releases[1]?.();
    expect((await pending).summary.success_count).toBe(2);
  });

  it("rejects at its deadline, naming the setting that controls it, and signals the hosts' work to stop", async () => {
    vi.useFakeTimers();
    let hostSignal: AbortSignal | undefined;
    const pending = runTargetOperation(buildInventoryModel(), buildConfig(), options({
      target: "leaf1",
      deadline: { ms: 50, settingName: "diagnostics.captureOverallOperationTimeoutMs" },
      run: (_host, signal) => { hostSignal = signal; return new Promise(() => undefined); }
    }));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "operation_timeout",
      message: "eos_test exceeded diagnostics.captureOverallOperationTimeoutMs 50"
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(hostSignal?.aborted).toBe(true);
  });

  it("rejects with operation_aborted when the caller cancels", async () => {
    const controller = new AbortController();
    const pending = runTargetOperation(buildInventoryModel(), buildConfig(), options({
      target: "leaf1",
      signal: controller.signal,
      run: () => new Promise(() => undefined)
    }));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "operation_aborted", message: "eos_test was cancelled" });
  });

  it.each([
    { label: "default advice", narrowingGuidance: undefined, guidance: "Reduce the number of target devices or narrow the request scope." },
    { label: "the caller's advice", narrowingGuidance: "Use a section filter.", guidance: "Use a section filter." }
  ])("rejects a response over maxResponseSizeBytes with $label", async ({ narrowingGuidance, guidance }) => {
    const run = async (host: InventoryHostModel): Promise<Entry[]> => [buildDeviceSuccess(host, { note: "x".repeat(1_000) })];
    await expect(runTargetOperation(buildInventoryModel(), buildConfig({ maxResponseSizeBytes: 500 }), options({
      target: "leaf1",
      run,
      ...(narrowingGuidance === undefined ? {} : { narrowingGuidance })
    }))).rejects.toMatchObject({ code: "response_size_exceeded", details: { maxResponseSizeBytes: 500, guidance } });
  });
});

describe("readOperationLimits", () => {
  it("uses readFanOut and names the top-level deadline", () => {
    expect(readOperationLimits(buildConfig({ readFanOut: 4, overallOperationTimeoutMs: 1_000 }))).toEqual({
      concurrency: 4,
      deadline: { ms: 1_000, settingName: "overallOperationTimeoutMs" }
    });
  });

  it("sets no deadline when overallOperationTimeoutMs is unset", () => {
    const config = buildConfig({ readFanOut: 4 });
    delete (config as { overallOperationTimeoutMs?: number }).overallOperationTimeoutMs;
    expect(readOperationLimits(config)).toEqual({ concurrency: 4 });
  });
});
