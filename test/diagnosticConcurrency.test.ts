import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import type { DiagnosticDeviceRunner, DiagnosticObservation } from "../src/diagnostics/types.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

const observation: DiagnosticObservation = {
  kind: "ping",
  output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n"
};

async function twoHostModel() {
  return loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  mcp_diagnostics_allowed: true",
    "hosts:", "  leaf1: {}", "  leaf2: {}",
    "groups:", "  switches:", "    hosts: [leaf1, leaf2]"
  ]));
}

/** Runner whose executions stay pending until the test settles them, in dispatch order. */
function controlledRunner() {
  const dispatched: Array<{ hostname: string; settle: () => void; fail: (error: AppError) => void }> = [];
  const runner: DiagnosticDeviceRunner = {
    execute: (host) => new Promise<DiagnosticObservation>((resolve, reject) => {
      dispatched.push({ hostname: host.inventoryHostname, settle: () => resolve(observation), fail: reject });
    })
  };
  return { runner, dispatched };
}

function ping(target: string, destinations = ["127.0.0.1"]) {
  return { target, request: { kind: "ping" as const, destinations } };
}

afterEach(() => vi.useRealTimers());

describe("per-device diagnostic concurrency", () => {
  it("runs pings on different devices at once while each device is at its own limit", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 4;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const running = executor.execute(ping("switches", ["127.0.0.1", "127.0.0.2"]));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1", "leaf2"]);
    expect(executor.getCapacity()).toMatchObject({
      limit: 4, device_limit: 1, available_count: 2, active_count: 2, uncertain_count: 0, queued_count: 2,
      devices: [
        { inventory_hostname: "leaf1", available_count: 0, active_count: 1, uncertain_count: 0, queued_count: 1 },
        { inventory_hostname: "leaf2", available_count: 0, active_count: 1, uncertain_count: 0, queued_count: 1 }
      ]
    });
    dispatched[0]?.settle();
    dispatched[1]?.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched).toHaveLength(4);
    dispatched[2]?.settle();
    dispatched[3]?.settle();
    expect((await running).summary).toEqual({ total_count: 4, success_count: 4, failed_count: 0 });
    expect(executor.getCapacity()).toMatchObject({ available_count: 4, active_count: 0, queued_count: 0, devices: [] });
  });

  it("keeps an uncertain slot on one device from blocking another device", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const lost = executor.execute(ping("leaf1"));
    await vi.advanceTimersByTimeAsync(0);
    dispatched[0]?.fail(new AppError("eapi_transport_error", "lost"));
    await lost;
    const healthy = executor.execute(ping("leaf2"));
    const blocked = executor.execute(ping("leaf1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1", "leaf2"]);
    dispatched[1]?.settle();
    expect((await healthy).summary.success_count).toBe(1);
    expect(executor.getCapacity()).toMatchObject({
      uncertain_count: 1, queued_count: 1,
      devices: [{ inventory_hostname: "leaf1", available_count: 0, uncertain_count: 1, queued_count: 1 }]
    });
    await vi.advanceTimersByTimeAsync(config.diagnostics.commandTimeoutMs);
    expect(dispatched).toHaveLength(3);
    dispatched[2]?.settle();
    expect((await blocked).summary.success_count).toBe(1);
  });

  it("still enforces the server-wide ceiling across devices", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const first = executor.execute(ping("leaf1"));
    const second = executor.execute(ping("leaf2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1"]);
    expect(executor.getCapacity()).toMatchObject({
      available_count: 0, queued_count: 1,
      devices: [
        { inventory_hostname: "leaf1", available_count: 0, active_count: 1 },
        { inventory_hostname: "leaf2", available_count: 0, active_count: 0, queued_count: 1 }
      ]
    });
    dispatched[0]?.settle();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1", "leaf2"]);
    dispatched[1]?.settle();
    expect((await second).summary.success_count).toBe(1);
  });

  it("does not let a ping waiting on a busy device hold up a later ping to a free one", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 2;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const holdingLeaf1 = executor.execute(ping("leaf1"));
    const holdingLeaf2 = executor.execute(ping("leaf2"));
    await vi.advanceTimersByTimeAsync(0);
    const waitingOnLeaf1 = executor.execute(ping("leaf1"));
    const waitingOnLeaf2 = executor.execute(ping("leaf2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity().queued_count).toBe(2);
    dispatched[1]?.settle();
    await holdingLeaf2;
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1", "leaf2", "leaf2"]);
    dispatched[2]?.settle();
    dispatched[0]?.settle();
    await Promise.all([holdingLeaf1, waitingOnLeaf2]);
    await vi.advanceTimersByTimeAsync(0);
    dispatched[3]?.settle();
    expect((await waitingOnLeaf1).summary.success_count).toBe(1);
  });

  it("removes a cancelled waiter behind a full device without disturbing other waiters", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const holdingLeaf1 = executor.execute(ping("leaf1"));
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const cancelledWaiter = executor.execute({ ...ping("leaf1"), signal: controller.signal });
    const cancelledRejection = expect(cancelledWaiter).rejects.toMatchObject({ code: "operation_aborted" });
    const laterWaiter = executor.execute(ping("leaf1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.getCapacity().devices).toEqual([
      { inventory_hostname: "leaf1", available_count: 0, active_count: 1, uncertain_count: 0, queued_count: 2 }
    ]);
    controller.abort();
    await cancelledRejection;
    expect(executor.getCapacity()).toMatchObject({ active_count: 1, queued_count: 1 });
    dispatched[0]?.settle();
    await holdingLeaf1;
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched).toHaveLength(2);
    dispatched[1]?.settle();
    expect((await laterWaiter).summary.success_count).toBe(1);
  });

  it("wakes a waiter on another device when an uncertain slot holding the server ceiling expires", async () => {
    vi.useFakeTimers();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    const { runner, dispatched } = controlledRunner();
    const executor = new DiagnosticExecutor(await twoHostModel(), config, runner);
    const lost = executor.execute(ping("leaf1"));
    await vi.advanceTimersByTimeAsync(0);
    dispatched[0]?.fail(new AppError("eapi_transport_error", "lost"));
    await lost;
    const waitingOnLeaf2 = executor.execute(ping("leaf2"));
    await vi.advanceTimersByTimeAsync(config.diagnostics.commandTimeoutMs - 1);
    expect(dispatched).toHaveLength(1);
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1, queued_count: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatched.map((execution) => execution.hostname)).toEqual(["leaf1", "leaf2"]);
    dispatched[1]?.settle();
    expect((await waitingOnLeaf2).summary.success_count).toBe(1);
  });
});
