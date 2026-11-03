import { describe, expect, it, vi } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import type { EapiTransport } from "../src/eapi/transport.js";
import type { EosTextCommandRunner } from "../src/eapi/types.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { DiagnosticExecutionError } from "../src/diagnostics/executionError.js";
import { preparePacketCapture } from "../src/diagnostics/packetCapture.js";
import { preparePing } from "../src/diagnostics/ping.js";
import { buildConfig, buildHost, buildInventoryModel, echoRpcTransport } from "./helpers.js";

const context = () => ({ signal: new AbortController().signal, requestId: "unit-rpc-id" });
const output = "1 packets transmitted, 1 received, 0% packet loss, time 0ms\n";
const host = buildHost({ effectiveVars: { ansible_user: "admin", ansible_password: "test-password" } });
const call = { target: "leaf1", request: { kind: "ping" as const, destinations: ["::1"] } };

function createSingleSlotExecutor(runner: EosTextCommandRunner): DiagnosticExecutor {
  const config = buildConfig();
  config.diagnostics.deviceConcurrency = 1;
  config.diagnostics.maxConcurrentDiagnostics = 1;
  return new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true, effectiveVars: host.effectiveVars }), config,
    new EapiDiagnosticRunner(config, runner));
}

// Recorded from cEOS 4.34.3M when runCmds.requestTimeout ends a capture short of its count; data[0] is `enable`.
const deviceTimeLimitError = {
  code: 1001,
  message: "CLI command 2 of 2 'tcpdump interface Ethernet1 packet-count 1 filter udp port 9' failed: unexpected error 408",
  data: [{ output: "" }, { errors: ["Command exceeded its allowed time limit"] }]
};

describe("diagnostic eAPI adapter", () => {
  it("sends one text request, in enable mode, using the configured version, diagnostic HTTP timeout, and EOS request timeout", async () => {
    const postJson = vi.fn<EapiTransport["postJson"]>(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ output: "" }, { output }] }), text: async () => "" }));
    const config = buildConfig({ readTimeoutMs: 7, eapiVersion: 1 });
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    const request = preparePing({ kind: "ping", destination: "::1", source: "::1", vrf: "default", count: 1 }, config.diagnostics);
    expect(await runner.execute(host, request, context())).toEqual({ end: "output", output });
    expect(postJson).toHaveBeenCalledTimes(1);
    const [connection, body] = postJson.mock.calls[0] ?? [];
    expect(connection).toMatchObject({ timeoutMs: 35_000, validateCerts: true });
    expect(JSON.parse(String(body)).id).toBe("unit-rpc-id");
    expect(JSON.parse(String(body)).params).toEqual({
      version: 1, format: "text", cmds: ["enable", "ping vrf default ipv6 ::1 source ::1 repeat 1 timeout 1 interval 1 size 64"], requestTimeout: 30
    });
  });

  it.each([
    { label: "derived from the command budget", settings: { commandTimeoutMs: 12_500 }, expected: 12.5 },
    { label: "omitted when disabled", settings: { nativeRequestTimeout: false }, expected: undefined }
  ])("sends the EOS request timeout $label", async ({ settings, expected }) => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ output: "" }, { output }] }), text: async () => "" }));
    const config = buildConfig();
    Object.assign(config.diagnostics, settings);
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    await runner.execute(host, preparePing({ kind: "ping", destination: "::1" }, config.diagnostics), context());
    const body = (postJson.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(JSON.parse(String(body)).params.requestTimeout).toBe(expected);
  });

  it("classifies local credential rejection as not dispatched without losing the error code", async () => {
    const postJson = vi.fn();
    const config = buildConfig();
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    const failure = runner.execute(buildHost(), preparePing({ kind: "ping", destination: "::1" }, config.diagnostics), context());
    await expect(failure).rejects.toBeInstanceOf(DiagnosticExecutionError);
    await expect(failure).rejects.toMatchObject({ code: "connection_username_missing", executionState: "not_dispatched" });
    expect(postJson).not.toHaveBeenCalled();
  });

  it.each([
    { code: 1002, message: "JSON output unavailable" },
    { code: 1003, message: "unconverted command" }
  ])("does not retry for JSON-RPC errors or claim remote completion ($code)", async (rpcError) => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: rpcError }), text: async () => "" }));
    const config = buildConfig();
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    await expect(runner.execute(host, preparePing({ kind: "ping", destination: "::1" }, config.diagnostics), context()))
      .rejects.toMatchObject({ executionState: "unknown" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it("exposes EOS RPC error evidence only when explicitly requested", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      error: { code: 1000, message: "private EOS error detail", data: [{ output: "" }, { output: "% private EOS error detail\\n" }] }
    }), text: async () => "" }));
    const config = buildConfig();
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true, effectiveVars: host.effectiveVars }), config,
      new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson }))));
    const normal = await executor.execute(call);
    expect(JSON.stringify(normal)).not.toContain("private EOS error detail");
    const diagnostic = await executor.execute({ ...call, includeRaw: true });
    expect(diagnostic.results[0]?.raw_output).toContain("private EOS error detail");
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  it.each([42, null, {}, { output: 42 }])("retains capacity after a correlated malformed text result (%j)", async (entry) => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ output: "" }, entry] }), text: async () => "" }));
    const executor = createSingleSlotExecutor(new EapiClient(echoRpcTransport({ postJson })));
    expect((await executor.execute(call)).results[0]?.error_code).toBe("eapi_text_output_invalid");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "missing", results: [] },
    { label: "non-text", results: [{ command: "ping", output_format: "text" as const, output: 42 }] }
  ])("retains capacity when the text runner returns a $label result", async ({ results }) => {
    const runTextCommands = vi.fn(async () => results);
    const executor = createSingleSlotExecutor({ runTextCommands });
    expect((await executor.execute(call)).results[0]?.error_code).toBe("diagnostic_output_unrecognized");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    expect(runTextCommands).toHaveBeenCalledTimes(1);
  });

  it("retains capacity when an invalid eAPI payload cannot confirm command completion", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ unexpected: "response" }), text: async () => "" }));
    const executor = createSingleSlotExecutor(new EapiClient(echoRpcTransport({ postJson })));
    expect((await executor.execute(call)).results[0]?.error_code).toBe("eapi_payload_invalid");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: 1000, message: "request timed out" },
    // The time limit hit during `enable`, so the ping never ran and this is not the device timer ending it.
    { code: 1001, message: "CLI command failed: unexpected error 408", data: [{ errors: ["Command exceeded its allowed time limit"] }] }
  ])("does not equate an EOS RPC interruption error with confirmed process exit ($code)", async (rpcError) => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: rpcError }), text: async () => "" }));
    const executor = createSingleSlotExecutor(new EapiClient(echoRpcTransport({ postJson })));
    await executor.execute(call);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 1, available_count: 0 });
  });

  // Measured on cEOS 4.34.3M: a ping stopped by runCmds.requestTimeout returns this reply, and its process is gone at once.
  const pingTimeLimitError = { ...deviceTimeLimitError, message: "CLI command 2 of 2 'ping ip ::1 repeat 1' failed: unexpected error 408" };

  it("observes that the device time limit stopped a ping", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: pingTimeLimitError }), text: async () => "" }));
    const config = buildConfig();
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    expect(await runner.execute(host, preparePing({ kind: "ping", destination: "::1" }, config.diagnostics), context()))
      .toEqual({ end: "device_time_limit" });
  });

  it("fails a ping the device time limit stopped, reporting no reachability, and frees its slot at once", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: pingTimeLimitError }), text: async () => "" }));
    const executor = createSingleSlotExecutor(new EapiClient(echoRpcTransport({ postJson })));
    const result = await executor.execute(call);
    expect(result.results[0]).toMatchObject({ status: "failed", error_code: "ping_device_time_limit_reached" });
    expect(result.results[0]).not.toHaveProperty("finding");
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 0, available_count: 1, reservations: [] });
  });

  it("does not claim command completion after a transport loss", async () => {
    const postJson = vi.fn(async () => { throw new Error("connection reset"); });
    const config = buildConfig();
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    await expect(runner.execute(host, preparePing({ kind: "ping", destination: "::1" }, config.diagnostics), context()))
      .rejects.toMatchObject({ code: "eapi_transport_error" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });
});

describe("packet capture eAPI adapter", () => {
  const packets = "22:06:07.386059 IP 10.255.255.1 > 10.255.255.0: ICMP echo request\n";
  const capture = (config = buildConfig()) =>
    preparePacketCapture({ kind: "packet_capture", interface: "Ethernet1", filter: "udp port 9", packet_count: 1, window_seconds: 2 }, config.diagnostics);

  it("observes that the device time limit ended a capture rather than failing it", async () => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: deviceTimeLimitError }), text: async () => "" }));
    const runner = new EapiDiagnosticRunner(buildConfig(), new EapiClient(echoRpcTransport({ postJson })));
    expect(await runner.execute(host, capture(), context())).toEqual({ end: "device_time_limit" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "1001 with another command error", rpcError: { ...deviceTimeLimitError, data: [{ output: "" }, { errors: ["Interface does not exist"] }] } },
    { label: "1001 without command errors", rpcError: { ...deviceTimeLimitError, data: [{ output: "" }, { output: "" }] } },
    { label: "the time-limit message under another RPC code", rpcError: { ...deviceTimeLimitError, code: 1000 } },
    { label: "a time limit hit during enable, before tcpdump ran",
      rpcError: { ...deviceTimeLimitError, message: "CLI command 1 of 2 'enable' failed: unexpected error 408", data: [{ errors: ["Command exceeded its allowed time limit"] }] } },
    { label: "a time limit reported after a failed enable",
      rpcError: { ...deviceTimeLimitError, data: [{ errors: ["Authorization denied"] }, { errors: ["Command exceeded its allowed time limit"] }] } }
  ])("keeps a capture uncertain after $label", async ({ rpcError }) => {
    const postJson = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: rpcError }), text: async () => "" }));
    const runner = new EapiDiagnosticRunner(buildConfig(), new EapiClient(echoRpcTransport({ postJson })));
    await expect(runner.execute(host, capture(), context())).rejects.toMatchObject({ code: "eapi_json_rpc_error", executionState: "unknown" });
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("always sends the window as the EOS request timeout and outlasts it over HTTP (nativeRequestTimeout %s)", async (nativeRequestTimeout) => {
    const postJson = vi.fn<EapiTransport["postJson"]>(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ output: "" }, { output: packets }] }), text: async () => "" }));
    const config = buildConfig();
    config.diagnostics.nativeRequestTimeout = nativeRequestTimeout;
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    const request = preparePacketCapture({ kind: "packet_capture", interface: "any", vrf: "MGMT", filter: "icmp", packet_count: 2, window_seconds: 7 }, config.diagnostics);
    expect(await runner.execute(host, request, context())).toEqual({ end: "output", output: packets });
    expect(postJson).toHaveBeenCalledTimes(1);
    const [connection, body] = postJson.mock.calls[0] ?? [];
    expect(connection?.timeoutMs).toBeGreaterThan(7000);
    expect(JSON.parse(String(body)).id).toBe("unit-rpc-id");
    expect(JSON.parse(String(body)).params).toEqual({
      version: "latest", format: "text", cmds: ["enable", "tcpdump interface any vrf MGMT packet-count 2 filter icmp"], requestTimeout: 7
    });
  });
});
