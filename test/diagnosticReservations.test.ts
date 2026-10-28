import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import type { DiagnosticDeviceRunner, DiagnosticObservation } from "../src/diagnostics/types.js";
import { buildGetServerInfoToolResult } from "../src/mcp/tools/getServerInfo.js";
import { buildPingToolResult, pingInputSchema } from "../src/mcp/tools/ping.js";
import { buildConfig, buildInventoryModel } from "./helpers.js";

const observation: DiagnosticObservation = {
  kind: "ping",
  output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n"
};
const call = { target: "leaf1", request: { kind: "ping" as const, destination: "127.0.0.1" } };

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("fail-closed diagnostic reservations", () => {
  it("exposes sanitized active and uncertain reservations without an expiry", async () => {
    vi.useFakeTimers();
    let fail!: (error: AppError) => void;
    const response = new Promise<DiagnosticObservation>((_resolve, reject) => { fail = reject; });
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, { execute: () => response });
    const pending = executor.execute(call);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity()).toMatchObject({
      scope: "server-instance", limit: 1, available_count: 0, active_count: 1, uncertain_count: 0, queued_count: 0,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "ping", state: "active" }]
    });
    fail(new AppError("eapi_transport_error", "Lost connection"));
    await pending;
    const capacity = executor.getCapacity();
    expect(capacity).toMatchObject({
      limit: 1, available_count: 0, active_count: 0, uncertain_count: 1, queued_count: 0,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "ping", state: "uncertain", reason_code: "eapi_transport_error" }]
    });
    expect(capacity.reservations[0]?.reservation_id).toEqual(expect.any(String));
    expect(capacity.reservations[0]?.reserved_at).toEqual(expect.any(String));
    expect(capacity.reservations[0]?.uncertain_since).toEqual(expect.any(String));
    expect(capacity.reservations[0]).not.toHaveProperty("expires_at");
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
    const pending = executor.execute(call);
    await vi.advanceTimersByTimeAsync(0);
    expect(info()).toHaveProperty("diagnostics.capacity.active_count", 1);
    fail(new AppError("eapi_transport_error", "lost"));
    await pending;
    expect(info()).toHaveProperty("diagnostics.capacity.uncertain_count", 1);
    expect(info()).toHaveProperty("diagnostics.capacity.reservations.0.inventory_hostname", "leaf1");
    expect(buildGetServerInfoToolResult(context).structuredContent).toHaveProperty("diagnostics.capacity", null);
  });

  it("marks cancellation uncertain immediately, rejects queued work, and releases only on a late confirmed response", async () => {
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
    expect(executor.getCapacity()).toMatchObject({ active_count: 0, uncertain_count: 1, queued_count: 0 });
    expect((await waiting).results[0]?.error_code).toBe("diagnostic_capacity_uncertain");
    await vi.advanceTimersByTimeAsync(86_400_000);
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    finish(observation);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 0 });
    expect((await executor.execute(call)).summary.success_count).toBe(1);
  });

  it("returns a machine-readable MCP error when uncertainty has exhausted capacity", async () => {
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, {
      execute: async () => { throw new AppError("eapi_transport_error", "lost"); }
    });
    await executor.execute(call);
    const result = await buildPingToolResult(pingInputSchema.parse({ target: "leaf1", destination: "127.0.0.1" }), executor);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error_code: "diagnostic_capacity_uncertain", message: expect.stringContaining("eos_get_server_info.diagnostics.capacity") }
    });
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

  it("never admits replacement work when an earlier timed-out command can still start later", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    let dispatched = 0;
    const start = (): void => { active += 1; peak = Math.max(peak, active); };
    const runner: DiagnosticDeviceRunner = {
      execute: () => {
        dispatched += 1;
        if (dispatched === 1) {
          // A controlled remote queue, not a measured EOS queue-latency claim.
          setTimeout(start, 65_500);
          setTimeout(() => { active -= 1; }, 67_500);
          return new Promise((_resolve, reject) => {
            setTimeout(() => reject(new AppError("eapi_request_timeout", "HTTP response lost")), 35_000);
          });
        }
        start();
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

    const replacement = executor.execute(call).then(
      (result) => result,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(32_500);
    expect(peak).toBe(1);
    expect(await replacement).toMatchObject({ code: "diagnostic_capacity_uncertain" });
    expect(dispatched).toBe(1);
  });
});
