import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import type { DiagnosticDeviceRunner, DiagnosticExecutionContext, DiagnosticObservation } from "../src/diagnostics/types.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildPacketCaptureToolResult, packetCaptureInputSchema } from "../src/mcp/tools/packetCapture.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

const packets = ["22:06:07.386059 IP 10.255.255.1 > 10.255.255.0: ICMP echo request", "22:06:07.386088 IP 10.255.255.0 > 10.255.255.1: ICMP echo reply"];
const observation: DiagnosticObservation = { kind: "packet_capture", output: `${packets.join("\n")}\n` };
const call = { target: "switches", request: { kind: "packet_capture" as const, interface: "Ethernet1", filter: "icmp", packet_count: 2 } };

function runner() {
  return { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async () => observation) };
}

/** leaf1 and leaf2 in group `switches`, both allowed to capture unless `leaf2Vars` says otherwise. */
async function captureModel(leaf2Vars: string[] = []) {
  return loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  mcp_diagnostics_allowed: true", "  mcp_packet_capture_allowed: true",
    "hosts:", "  leaf1: {}", "  leaf2:", "    ansible_host: leaf2", ...leaf2Vars.map((line) => `    ${line}`),
    "groups:", "  switches:", "    hosts: [leaf2, leaf1]"
  ]));
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("packet capture execution", () => {
  it("returns one complete capture finding per resolved host, without a destination", async () => {
    const device = runner();
    const result = await new DiagnosticExecutor(await captureModel(), buildConfig(), device).execute(call);
    expect(result.request).toEqual({ kind: "packet_capture", interface: "Ethernet1", filter: "icmp", packet_count: 2, window_seconds: 10 });
    expect(result.summary).toEqual({ total_count: 2, success_count: 2, failed_count: 0 });
    expect(result.results).toEqual([
      { inventory_hostname: "leaf1", resolved_endpoint: "leaf1", status: "success",
        finding: { kind: "packet_capture", capture: "complete", requested_packet_count: 2, window_seconds: 10, packets } },
      { inventory_hostname: "leaf2", resolved_endpoint: "leaf2", status: "success",
        finding: { kind: "packet_capture", capture: "complete", requested_packet_count: 2, window_seconds: 10, packets } }
    ]);
    expect(device.execute.mock.calls.map(([host, execution]) => [host.inventoryHostname, execution])).toEqual(expect.arrayContaining([
      ["leaf1", { kind: "packet_capture", interface: "Ethernet1", filter: "icmp", packet_count: 2, window_seconds: 10 }],
      ["leaf2", { kind: "packet_capture", interface: "Ethernet1", filter: "icmp", packet_count: 2, window_seconds: 10 }]
    ]));
  });

  it.each([
    "mcp_packet_capture_allowed: false",
    "mcp_diagnostics_allowed: false"
  ])("rejects the whole group before dispatch when one host lacks capture permission (%s)", async (leaf2Permission) => {
    const device = runner();
    await expect(new DiagnosticExecutor(await captureModel([leaf2Permission]), buildConfig(), device).execute(call))
      .rejects.toMatchObject({ code: "packet_capture_policy_denied", message: "Packet capture permission denied for: leaf2" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("budgets resolved hosts times packet count against maxCapturePacketsPerRequest, not the ping probe budget", async () => {
    const device = runner();
    const config = buildConfig();
    config.diagnostics.maxCapturePacketsPerRequest = 2000;
    config.diagnostics.maxProbesPerRequest = 1;
    const executor = new DiagnosticExecutor(await captureModel(), config, device);
    expect((await executor.execute({ ...call, request: { ...call.request, packet_count: 1000 } })).summary.success_count).toBe(2);
    config.diagnostics.maxCapturePacketsPerRequest = 1999;
    await expect(executor.execute({ ...call, request: { ...call.request, packet_count: 1000 } }))
      .rejects.toMatchObject({ code: "packet_capture_packet_limit_exceeded" });
    expect(device.execute).toHaveBeenCalledTimes(2);
  });

  it("holds an uncertain capture's slot for its own window plus 2 s, shown as a packet_capture reservation", async () => {
    vi.useFakeTimers();
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>()
      .mockRejectedValueOnce(new AppError("eapi_transport_error", "lost response"))
      .mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    const executor = new DiagnosticExecutor(await captureModel(), config, device);
    const leaf1Capture = { ...call, target: "leaf1", request: { ...call.request, window_seconds: 5 } };
    expect((await executor.execute(leaf1Capture)).results[0]).toMatchObject({ status: "failed", error_code: "eapi_transport_error" });
    const capacity = executor.getCapacity();
    expect(capacity).toMatchObject({
      available_count: 0, uncertain_count: 1,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "packet_capture", state: "uncertain", reason_code: "eapi_transport_error" }]
    });
    const reservation = capacity.reservations[0];
    expect(Date.parse(reservation?.releases_at ?? "") - Date.parse(reservation?.uncertain_since ?? "")).toBe(7000);
    await vi.advanceTimersByTimeAsync(6999);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 1, available_count: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 0, available_count: 1 });
    expect((await executor.execute(leaf1Capture)).summary.success_count).toBe(1);
  });

  it("reports a capture ended by the device timer as a successful unfilled finding and frees its slot at once", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>()
      .mockResolvedValueOnce({ kind: "packet_capture", deviceTimeLimitReached: true })
      .mockResolvedValue(observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    const executor = new DiagnosticExecutor(await captureModel(), config, device);
    const leaf1Capture = { ...call, target: "leaf1", request: { ...call.request, window_seconds: 5 } };
    const unfilled = await executor.execute({ ...leaf1Capture, includeRaw: true });
    expect(unfilled.summary).toEqual({ total_count: 1, success_count: 1, failed_count: 0 });
    expect(unfilled.results).toEqual([{
      inventory_hostname: "leaf1", resolved_endpoint: "leaf1", status: "success",
      finding: { kind: "packet_capture", capture: "unfilled", requested_packet_count: 2, window_seconds: 5, packets: [] }
    }]);
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 0, reservations: [] });
    expect((await executor.execute(leaf1Capture)).results[0]).toMatchObject({ status: "success", finding: { capture: "complete" } });
  });

  it("fails only the entry of a host whose tcpdump exited without capturing, and frees its slot at once", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async (host) =>
      host.inventoryHostname === "leaf2" ? { kind: "packet_capture", output: "" } : observation) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    const executor = new DiagnosticExecutor(await captureModel(), config, device);
    const result = await executor.execute({ ...call, request: { ...call.request, filter: "notaproto foo" } });
    expect(result.summary).toEqual({ total_count: 2, success_count: 1, failed_count: 1 });
    expect(result.results[0]).toMatchObject({ inventory_hostname: "leaf1", status: "success", finding: { capture: "complete" } });
    expect(result.results[1]).toEqual({
      inventory_hostname: "leaf2", resolved_endpoint: "leaf2", status: "failed", error_code: "packet_capture_filter_rejected",
      message: "tcpdump exited without capturing: the filter is probably not valid pcap-filter syntax, or interface Ethernet1 cannot be captured on"
    });
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 0, reservations: [] });
  });

  it("bounds the whole call by captureOverallOperationTimeoutMs rather than ping's deadline", async () => {
    vi.useFakeTimers();
    const device = { execute: vi.fn((_host, _execution, { signal }: DiagnosticExecutionContext) => new Promise<DiagnosticObservation>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const config = buildConfig();
    config.diagnostics.overallOperationTimeoutMs = 50;
    config.diagnostics.captureOverallOperationTimeoutMs = 20_000;
    let settled = false;
    const pending = new DiagnosticExecutor(await captureModel(), config, device).execute(call).finally(() => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({ code: "operation_timeout" });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(device.execute.mock.calls.every(([, , context]) => context.signal.aborted)).toBe(true);
  });

  it("fails only the entry of a host where the interface does not exist", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async (host) => {
      if (host.inventoryHostname === "leaf2") throw new AppError("eapi_json_rpc_error", "EOS diagnostic request failed (eapi_json_rpc_error)");
      return observation;
    }) };
    const result = await new DiagnosticExecutor(await captureModel(), buildConfig(), device).execute(call);
    expect(result.summary).toEqual({ total_count: 2, success_count: 1, failed_count: 1 });
    expect(result.results[0]).toMatchObject({ inventory_hostname: "leaf1", status: "success", finding: { capture: "complete" } });
    expect(result.results[1]).toEqual({
      inventory_hostname: "leaf2", resolved_endpoint: "leaf2", status: "failed",
      error_code: "eapi_json_rpc_error", message: "EOS diagnostic request failed (eapi_json_rpc_error)"
    });
  });

  it.each([
    { change: { interface: "fabric" }, code: "packet_capture_interface_invalid" },
    { change: { vrf: "MGMT" }, code: "packet_capture_vrf_requires_any" },
    { change: { filter: "icmp\nreload" }, code: "packet_capture_filter_invalid" },
    { change: { packet_count: 1001 }, code: "packet_capture_count_invalid" },
    { change: { window_seconds: 61 }, code: "packet_capture_window_invalid" }
  ])("rejects $code before dispatch", async ({ change, code }) => {
    const device = runner();
    await expect(new DiagnosticExecutor(await captureModel(), buildConfig(), device).execute({ ...call, request: { ...call.request, ...change } }))
      .rejects.toMatchObject({ code });
    expect(device.execute).not.toHaveBeenCalled();
  });
});

describe("eos_packet_capture tool", () => {
  it("passes every input through to the capture and returns structured results", async () => {
    const device = runner();
    const executor = new DiagnosticExecutor(await captureModel(), buildConfig(), device);
    const args = packetCaptureInputSchema.parse({ target: "leaf1", interface: "any", vrf: "MGMT", filter: "icmp", packet_count: 2, window_seconds: 5 });
    const result = await buildPacketCaptureToolResult(args, executor);
    expect(result.structuredContent).toMatchObject({
      request: { kind: "packet_capture", interface: "any", vrf: "MGMT", filter: "icmp", packet_count: 2, window_seconds: 5 },
      results: [{ inventory_hostname: "leaf1", finding: { kind: "packet_capture", capture: "complete", packets } }]
    });
    expect(device.execute.mock.calls[0]?.[1]).toEqual({ kind: "packet_capture", interface: "any", vrf: "MGMT", filter: "icmp", packet_count: 2, window_seconds: 5 });
  });

  it("requires target and interface and rejects unknown fields, including include_raw", () => {
    const valid = { target: "leaf1", interface: "Ethernet1" };
    expect(packetCaptureInputSchema.parse(valid)).toEqual(valid);
    expect(packetCaptureInputSchema.safeParse({ target: "leaf1" }).success).toBe(false);
    expect(packetCaptureInputSchema.safeParse({ interface: "Ethernet1" }).success).toBe(false);
    expect(packetCaptureInputSchema.safeParse({ ...valid, include_raw: true }).success).toBe(false);
    expect(packetCaptureInputSchema.safeParse({ ...valid, file: "flash:startup-config" }).success).toBe(false);
    expect(packetCaptureInputSchema.safeParse({ ...valid, packet_count: 1.5 }).success).toBe(false);
    expect(packetCaptureInputSchema.safeParse({ ...valid, window_seconds: 0 }).success).toBe(false);
  });
});
