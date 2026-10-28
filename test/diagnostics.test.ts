import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import type { DiagnosticExecutionContext, PreparedDiagnostic } from "../src/diagnostics/types.js";
import type { InventoryHostModel } from "../src/inventory/types.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { DiagnosticExecutionError } from "../src/diagnostics/executionError.js";
import type { DiagnosticObservation } from "../src/diagnostics/types.js";
import { loadInventoryModel, validateInventory } from "../src/inventory/loadInventory.js";
import { buildListInventoryView } from "../src/inventory/listInventoryView.js";
import { buildPingToolResult, pingInputSchema } from "../src/mcp/tools/ping.js";
import { buildConfig, buildInventoryModel, writeTempInventory } from "./helpers.js";

const output = "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\nrtt min/avg/max/mdev = 0.020/0.025/0.030/0.001 ms\n";
const observation: DiagnosticObservation = { kind: "ping", output };
const call = { target: "leaf1", request: { kind: "ping" as const, destinations: ["127.0.0.1"] } };

function runner() {
  return { execute: vi.fn(async () => observation) };
}

async function groupModel(extra = "") {
  return loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  mcp_diagnostics_allowed: true",
    "hosts:", "  leaf1: {}", "  leaf2:", ...(extra ? [`    ${extra}`] : ["    ansible_host: leaf2"]),
    "groups:", "  switches:", "    hosts: [leaf2, leaf1]"
  ]));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("diagnostic policy and fan-out", () => {
  it("denies diagnostics by default, even when read is permitted", async () => {
    const device = runner();
    await expect(new DiagnosticExecutor(buildInventoryModel(), buildConfig(), device).execute(call))
      .rejects.toMatchObject({ code: "diagnostic_policy_denied" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("inherits explicit diagnostic permission but read denial vetoes it", async () => {
    const model = await groupModel("mcp_read_allowed: false");
    expect(model.hostMap.get("leaf1")?.diagnosticsAllowed).toBe(true);
    expect(model.hostMap.get("leaf2")?.diagnosticsAllowed).toBe(false);
    const device = runner();
    await expect(new DiagnosticExecutor(model, buildConfig(), device).execute({ ...call, target: "switches" }))
      .rejects.toMatchObject({ code: "policy_denied" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("rejects an entire mixed-permission group before any dispatch", async () => {
    const device = runner();
    await expect(new DiagnosticExecutor(await groupModel("mcp_diagnostics_allowed: false"), buildConfig(), device)
      .execute({ ...call, target: "switches" })).rejects.toMatchObject({ code: "diagnostic_policy_denied" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("strictly validates the inventory opt-in instead of accepting truthy strings", async () => {
    const result = await validateInventory(await writeTempInventory([
      "hosts:", "  leaf1:", "    ansible_network_os: eos", '    mcp_diagnostics_allowed: "true"'
    ]));
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "inventory_var_type_invalid" })]));
  });

  it("reports diagnostic permission in the sanitized inventory view", async () => {
    const view = buildListInventoryView(await groupModel(), { includeIneligible: false });
    expect(view.hosts.every((host) => host.diagnostics_allowed)).toBe(true);
  });

  it("enforces aggregate probe and existing target limits before dispatch", async () => {
    const device = runner();
    const config = buildConfig();
    config.diagnostics.maxProbesPerRequest = 5;
    config.diagnostics.maxPingCount = 5;
    const model = await groupModel();
    await expect(new DiagnosticExecutor(model, config, device).execute({ ...call, target: "switches" }))
      .rejects.toMatchObject({ code: "diagnostic_probe_limit_exceeded" });
    await expect(new DiagnosticExecutor(model, buildConfig({ maxReadTargets: 1 }), device).execute({ ...call, target: "switches" }))
      .rejects.toMatchObject({ code: "read_target_limit_exceeded" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("rejects invalid input and noninventory targets before dispatch", async () => {
    const device = runner();
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), device);
    await expect(executor.execute({ ...call, request: { ...call.request, destinations: ["127.0.0.1;reload"] } }))
      .rejects.toMatchObject({ code: "diagnostic_address_invalid" });
    await expect(executor.execute({ ...call, target: "192.0.2.50" })).rejects.toMatchObject({ code: "target_not_found" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("returns ordered per-device findings and execution counts, with raw output opt-in", async () => {
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), runner());
    const result = await executor.execute({ ...call, target: "switches" });
    expect(result.resolved_devices).toEqual(["leaf1", "leaf2"]);
    expect(result.summary).toEqual({ total_count: 2, success_count: 2, failed_count: 0 });
    expect(result.results[0]?.finding?.reachability).toBe("reachable");
    expect(result.results[0]).not.toHaveProperty("raw_output");
    expect((await executor.execute({ ...call, includeRaw: true })).results[0]?.raw_output).toBe(output);
  });

  it("treats zero replies as a finding, not an execution error", async () => {
    const device = { execute: vi.fn(async () => ({ kind: "ping" as const, output: "3 packets transmitted, 0 received, 100% packet loss, time 2000ms\n" })) };
    const result = await new DiagnosticExecutor(await groupModel(), buildConfig(), device).execute(call);
    expect(result.summary.success_count).toBe(1);
    expect(result.results[0]?.finding?.reachability).toBe("unreachable");
  });

  it("returns malformed output as a device failure, exposing evidence only when requested", async () => {
    const device = { execute: vi.fn(async () => ({ kind: "ping" as const, output: "unexpected" })) };
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), device);
    const result = await executor.execute(call);
    expect(result.results[0]).toMatchObject({ status: "failed", error_code: "diagnostic_output_unrecognized" });
    expect(result.results[0]).not.toHaveProperty("finding");
    expect(result.results[0]).not.toHaveProperty("raw_output");
    expect((await executor.execute({ ...call, includeRaw: true })).results[0]?.raw_output).toBe("unexpected");
  });

  it("enforces the existing serialized response size limit", async () => {
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig({ maxResponseSizeBytes: 10 }), runner());
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "response_size_exceeded" });
  });

  it("publishes structured MCP output and a strict non-empty input schema", async () => {
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), runner());
    const args = pingInputSchema.parse({ target: "leaf1", destinations: ["::1"] });
    const result = await buildPingToolResult(args, executor);
    expect(result.structuredContent).toHaveProperty("results.0.finding.reachability", "reachable");
    expect(pingInputSchema.safeParse({ ...args, command: "reload" }).success).toBe(false);
    expect(pingInputSchema.safeParse({ ...args, count: 1.5 }).success).toBe(false);
  });
});

describe("server-wide diagnostic admission and deadlines", () => {
  it("shares concurrency across simultaneous calls and releases completed commands immediately", async () => {
    const model = await groupModel();
    vi.useFakeTimers();
    const first = deferred<DiagnosticObservation>();
    const device = { execute: vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(model, config, device);
    const one = executor.execute(call);
    const two = executor.execute({ ...call, target: "leaf2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(device.execute).toHaveBeenCalledTimes(1);
    first.resolve(observation);
    await Promise.all([one, two]);
    expect(device.execute).toHaveBeenCalledTimes(2);
  });

  it("never releases a lost HTTP request's slot on elapsed time alone", async () => {
    const model = await groupModel();
    vi.useFakeTimers();
    const device = { execute: vi.fn().mockRejectedValueOnce(new AppError("eapi_transport_error", "lost response")).mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(model, config, device);
    const failed = await executor.execute(call);
    expect(failed.results[0]?.error_code).toBe("eapi_transport_error");
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    await vi.advanceTimersByTimeAsync(86_400_000);
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    expect(device.execute).toHaveBeenCalledTimes(1);
    expect(executor.getCapacity()).toMatchObject({ active_count: 0, uncertain_count: 1, available_count: 0 });
  });

  it.each(["not_dispatched", "completed"] as const)("releases an error explicitly classified as %s immediately", async (executionState) => {
    const model = await groupModel();
    const device = { execute: vi.fn().mockRejectedValueOnce(new DiagnosticExecutionError("diagnostic_test_failure", "Classified adapter failure", executionState)).mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(model, config, device);
    expect((await executor.execute(call)).results[0]?.error_code).toBe("diagnostic_test_failure");
    expect((await executor.execute(call)).summary.success_count).toBe(1);
  });

  it.each([
    new DiagnosticExecutionError("diagnostic_test_failure", "Unknown execution state", "unknown"),
    new AppError("diagnostic_test_failure", "An untyped marker is not a completion classification", { command_completed: true })
  ])("retains capacity without a typed settled classification (%s)", async (error) => {
    const model = await groupModel();
    const device = { execute: vi.fn().mockRejectedValue(error) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(model, config, device);
    expect((await executor.execute(call)).results[0]?.error_code).toBe("diagnostic_test_failure");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    expect(device.execute).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling group hosts on the overall deadline and aborts HTTP work", async () => {
    const model = await groupModel();
    vi.useFakeTimers();
    const device = { execute: vi.fn((_host, _request, { signal }: DiagnosticExecutionContext) => new Promise<DiagnosticObservation>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.overallOperationTimeoutMs = 50;
    const pending = new DiagnosticExecutor(model, config, device).execute({ ...call, target: "switches" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "operation_timeout" });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(device.execute).toHaveBeenCalledTimes(1);
    expect(device.execute.mock.calls[0]?.[2].signal.aborted).toBe(true);
  });

  it("retains an active command's slot after caller cancellation", async () => {
    const model = await groupModel();
    vi.useFakeTimers();
    const device = { execute: vi.fn()
      .mockImplementationOnce((_host, _request, { signal }: DiagnosticExecutionContext) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.overallOperationTimeoutMs = 120_000;
    const executor = new DiagnosticExecutor(model, config, device);
    const controller = new AbortController();
    const active = executor.execute({ ...call, signal: controller.signal });
    const rejected = expect(active).rejects.toMatchObject({ code: "operation_aborted" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    await vi.advanceTimersByTimeAsync(86_400_000);
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
    expect(device.execute).toHaveBeenCalledTimes(1);
  });

  it("removes cancelled waiters and never dispatches them later", async () => {
    const model = await groupModel();
    vi.useFakeTimers();
    const first = deferred<DiagnosticObservation>();
    const device = { execute: vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(model, config, device);
    const active = executor.execute(call);
    const controller = new AbortController();
    const waiting = executor.execute({ ...call, signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ code: "operation_aborted" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    first.resolve(observation);
    await active;
    await executor.execute(call);
    expect(device.execute).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch a call cancelled before execution", async () => {
    const device = runner();
    const controller = new AbortController();
    controller.abort();
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), device);
    await expect(executor.execute({ ...call, signal: controller.signal })).rejects.toMatchObject({ code: "operation_aborted" });
    expect(device.execute).not.toHaveBeenCalled();
  });
});

describe("multi-destination ping", () => {
  const sweep = (destinations: string[]) => ({ target: "switches", request: { kind: "ping" as const, destinations } });
  const dispatched = (device: { execute: ReturnType<typeof vi.fn> }) =>
    device.execute.mock.calls.map(([host, execution]: [InventoryHostModel, PreparedDiagnostic]) => `${host.inventoryHostname}>${execution.destination}`);

  it("returns one result per host and destination in host-then-destination order", async () => {
    const device = runner();
    const result = await new DiagnosticExecutor(await groupModel(), buildConfig(), device).execute(sweep(["127.0.0.1", "::1"]));
    expect(result.resolved_devices).toEqual(["leaf1", "leaf2"]);
    expect(result.summary).toEqual({ total_count: 4, success_count: 4, failed_count: 0 });
    expect(result.results.map((entry) => `${entry.inventory_hostname}>${entry.destination}`))
      .toEqual(["leaf1>127.0.0.1", "leaf1>::1", "leaf2>127.0.0.1", "leaf2>::1"]);
    expect(result.request).toEqual({ kind: "ping", destinations: ["127.0.0.1", "::1"], count: 3 });
    expect(dispatched(device).sort()).toEqual(["leaf1>127.0.0.1", "leaf1>::1", "leaf2>127.0.0.1", "leaf2>::1"]);
  });

  it("dispatches destinations concurrently up to the shared device concurrency", async () => {
    vi.useFakeTimers();
    const pendingObservations: Array<ReturnType<typeof deferred<DiagnosticObservation>>> = [];
    const device = { execute: vi.fn(() => {
      const pendingObservation = deferred<DiagnosticObservation>();
      pendingObservations.push(pendingObservation);
      return pendingObservation.promise;
    }) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 2;
    const executor = new DiagnosticExecutor(await groupModel(), config, device);
    const running = executor.execute({ ...call, request: { kind: "ping", destinations: ["127.0.0.1", "127.0.0.2", "127.0.0.3"] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(device.execute).toHaveBeenCalledTimes(2);
    expect(executor.getCapacity()).toMatchObject({ active_count: 2, available_count: 0 });
    pendingObservations[0]?.resolve(observation);
    await vi.advanceTimersByTimeAsync(0);
    expect(device.execute).toHaveBeenCalledTimes(3);
    pendingObservations[1]?.resolve(observation);
    pendingObservations[2]?.resolve(observation);
    expect((await running).summary).toEqual({ total_count: 3, success_count: 3, failed_count: 0 });
  });

  it("isolates an execution failure to its own destination", async () => {
    const device = { execute: vi.fn(async (_host: InventoryHostModel, execution: PreparedDiagnostic) => {
      if (execution.destination === "127.0.0.2") {
        throw new DiagnosticExecutionError("diagnostic_test_failure", "Classified adapter failure", "completed");
      }
      return observation;
    }) };
    const result = await new DiagnosticExecutor(await groupModel(), buildConfig(), device)
      .execute({ ...call, request: { kind: "ping", destinations: ["127.0.0.1", "127.0.0.2", "127.0.0.3"] } });
    expect(result.summary).toEqual({ total_count: 3, success_count: 2, failed_count: 1 });
    expect(result.results[1]).toMatchObject({ destination: "127.0.0.2", status: "failed", error_code: "diagnostic_test_failure" });
    expect(result.results[1]).not.toHaveProperty("finding");
  });

  it.each([
    { destinations: ["127.0.0.1", "127.0.0.1;reload"], code: "diagnostic_address_invalid" },
    { destinations: ["127.0.0.1", "127.0.0.1"], code: "diagnostic_destination_duplicate" },
    { destinations: ["::1", "0:0:0:0:0:0:0:1"], code: "diagnostic_destination_duplicate" },
    { destinations: ["2001:db8::1", "2001:DB8:0::1"], code: "diagnostic_destination_duplicate" },
    { destinations: ["::ffff:192.0.2.1", "::ffff:c000:201"], code: "diagnostic_destination_duplicate" },
    { destinations: [], code: "diagnostic_destination_limit_exceeded" },
    { destinations: ["127.0.0.1", "127.0.0.2", "127.0.0.3"], code: "diagnostic_destination_limit_exceeded" }
  ])("rejects the whole request before dispatch: $code", async ({ destinations, code }) => {
    const device = runner();
    const config = buildConfig();
    config.diagnostics.maxDestinationsPerRequest = 2;
    await expect(new DiagnosticExecutor(await groupModel(), config, device).execute(sweep(destinations)))
      .rejects.toMatchObject({ code });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("keeps the caller's spelling and treats an IPv4 address and its IPv4-mapped IPv6 form as distinct", async () => {
    const device = runner();
    const result = await new DiagnosticExecutor(await groupModel(), buildConfig(), device)
      .execute({ ...call, request: { kind: "ping", destinations: ["192.0.2.1", "::ffff:192.0.2.1", "2001:DB8::1"] } });
    expect(result.results.map((entry) => entry.destination)).toEqual(["192.0.2.1", "::ffff:192.0.2.1", "2001:DB8::1"]);
    expect(device.execute).toHaveBeenCalledTimes(3);
  });

  it("requires the source address family to match every destination", async () => {
    const device = runner();
    const executor = new DiagnosticExecutor(await groupModel(), buildConfig(), device);
    await expect(executor.execute({ ...call, request: { kind: "ping", destinations: ["127.0.0.1", "::1"], source: "127.0.0.1" } }))
      .rejects.toMatchObject({ code: "diagnostic_source_invalid" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("counts every destination against the aggregate probe budget", async () => {
    const device = runner();
    const config = buildConfig();
    config.diagnostics.maxProbesPerRequest = 5;
    await expect(new DiagnosticExecutor(await groupModel(), config, device)
      .execute({ ...call, request: { kind: "ping", destinations: ["127.0.0.1", "::1"] } }))
      .rejects.toMatchObject({ code: "diagnostic_probe_limit_exceeded" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("leaves only in-flight executions uncertain when a sweep is cancelled", async () => {
    vi.useFakeTimers();
    const device = { execute: vi.fn((_host, _execution, { signal }: DiagnosticExecutionContext) => new Promise<DiagnosticObservation>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 2;
    const executor = new DiagnosticExecutor(await groupModel(), config, device);
    const controller = new AbortController();
    const running = executor.execute({ ...call, request: { kind: "ping", destinations: ["127.0.0.1", "127.0.0.2", "127.0.0.3"] }, signal: controller.signal });
    const rejected = expect(running).rejects.toMatchObject({ code: "operation_aborted" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(device.execute).toHaveBeenCalledTimes(2);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 2, queued_count: 0 });
  });

  it("rejects the removed single destination field with guidance", () => {
    const parsed = pingInputSchema.safeParse({ target: "leaf1", destination: "127.0.0.1" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["destinations"] }),
      expect.objectContaining({ code: "unrecognized_keys", message: expect.stringContaining("destinations: [\"<ip>\"]") })
    ]));
    expect(pingInputSchema.safeParse({ target: "leaf1", destinations: [] }).success).toBe(false);
  });
});
