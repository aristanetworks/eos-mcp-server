import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import type { DiagnosticDeviceRunner, DiagnosticObservation } from "../src/diagnostics/types.js";
import { buildGetServerInfoToolResult } from "../src/mcp/tools/getServerInfo.js";
import { buildConfig, buildInventoryModel } from "./helpers.js";

const observation: DiagnosticObservation = {
  kind: "ping",
  output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n"
};
const call = { target: "leaf1", request: { kind: "ping" as const, destinations: ["127.0.0.1"] } };

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("time-bounded diagnostic reservations", () => {
  it("exposes sanitized active and uncertain reservations with their release time", async () => {
    vi.useFakeTimers();
    let fail!: (error: AppError) => void;
    const response = new Promise<DiagnosticObservation>((_resolve, reject) => { fail = reject; });
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, { execute: () => response });
    const pending = executor.execute(call);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity()).toMatchObject({
      limit: 1, available_count: 0, active_count: 1, uncertain_count: 0, queued_count: 0,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "ping", state: "active" }]
    });
    fail(new AppError("eapi_transport_error", "Lost connection"));
    await pending;
    const capacity = executor.getCapacity();
    expect(capacity).toMatchObject({
      limit: 1, available_count: 0, active_count: 0, uncertain_count: 1, queued_count: 0,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "ping", state: "uncertain", reason_code: "eapi_transport_error" }]
    });
    const reservation = capacity.reservations[0];
    expect(reservation?.reservation_id).toEqual(expect.any(String));
    expect(reservation?.reserved_at).toEqual(expect.any(String));
    expect(Date.parse(reservation?.releases_at ?? "") - Date.parse(reservation?.uncertain_since ?? ""))
      .toBe(config.diagnostics.commandTimeoutMs);
    expect(JSON.stringify(capacity)).not.toContain("127.0.0.1");
  });

  it("reports live capacity through server info instead of caching an initial snapshot", async () => {
    vi.useFakeTimers();
    let fail!: (error: AppError) => void;
    const response = new Promise<DiagnosticObservation>((_resolve, reject) => { fail = reject; });
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, { execute: () => response });
    const context = { instanceId: "instance-1", startedAt: new Date().toISOString(), config };
    const info = () => buildGetServerInfoToolResult(context, executor.getCapacity()).structuredContent;
    expect(info()).toHaveProperty("diagnostics.capacity.available_count", 1);
    expect(info()).toHaveProperty("limits.diagnostics.native_request_timeout", true);
    const pending = executor.execute(call);
    await vi.advanceTimersByTimeAsync(0);
    expect(info()).toHaveProperty("diagnostics.capacity.active_count", 1);
    fail(new AppError("eapi_transport_error", "lost"));
    await pending;
    expect(info()).toHaveProperty("diagnostics.capacity.uncertain_count", 1);
    expect(info()).toHaveProperty("diagnostics.capacity.reservations.0.inventory_hostname", "leaf1");
    expect(buildGetServerInfoToolResult(context).structuredContent).toHaveProperty("diagnostics.capacity", null);
  });

  it("marks cancellation uncertain immediately, keeps queued work waiting, and frees the slot early on a late confirmed response", async () => {
    vi.useFakeTimers();
    let finish!: (value: DiagnosticObservation) => void;
    const response = new Promise<DiagnosticObservation>((resolve) => { finish = resolve; });
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, { execute: () => response });
    const controller = new AbortController();
    const active = executor.execute({ ...call, signal: controller.signal });
    const rejected = expect(active).rejects.toMatchObject({ code: "operation_aborted" });
    const waiting = executor.execute(call);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity().queued_count).toBe(1);
    controller.abort();
    await rejected;
    expect(executor.getCapacity()).toMatchObject({ active_count: 0, uncertain_count: 1, queued_count: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(executor.getCapacity().queued_count).toBe(1);
    finish(observation);
    expect((await waiting).summary.success_count).toBe(1);
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 0 });
  });

  it("continues using healthy capacity without freeing an uncertain reservation", async () => {
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 2;
    const runner = { execute: vi.fn().mockRejectedValueOnce(new AppError("eapi_transport_error", "lost")).mockResolvedValue(observation) };
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, runner);
    await executor.execute(call);
    const healthy = await Promise.all([executor.execute(call), executor.execute(call), executor.execute(call)]);
    expect(healthy.every((result) => result.summary.success_count === 1)).toBe(true);
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 1, queued_count: 0 });
    const copy = executor.getCapacity();
    const reservation = copy.reservations[0];
    expect(reservation).toBeDefined();
    if (reservation !== undefined) {
      reservation.state = "active";
    }
    copy.reservations.length = 0;
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 1, reservations: [{ state: "uncertain" }] });
  });

  it("admits replacement work only after a timed-out command's hold has elapsed", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    let dispatched = 0;
    const start = (): void => { active += 1; peak = Math.max(peak, active); };
    const runner: DiagnosticDeviceRunner = {
      execute: () => {
        dispatched += 1;
        start();
        if (dispatched === 1) {
          // Remote work finishes within the command budget, but its HTTP response is lost.
          setTimeout(() => { active -= 1; }, 30_000);
          return new Promise((_resolve, reject) => {
            setTimeout(() => reject(new AppError("eapi_request_timeout", "HTTP response lost")), 35_000);
          });
        }
        return new Promise((resolve) => setTimeout(() => {
          active -= 1;
          resolve(observation);
        }, 2000));
      }
    };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, runner);
    const first = executor.execute(call);
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await first).results[0]?.error_code).toBe("eapi_request_timeout");

    const replacement = executor.execute(call);
    await vi.advanceTimersByTimeAsync(config.diagnostics.commandTimeoutMs - 1);
    expect(dispatched).toBe(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await replacement).summary.success_count).toBe(1);
    expect(dispatched).toBe(2);
    expect(peak).toBe(1);
  });
});
