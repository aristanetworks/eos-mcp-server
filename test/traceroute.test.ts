import { afterEach, describe, expect, it, vi } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import type { EapiTransport } from "../src/eapi/transport.js";
import { AppError } from "../src/core/errors.js";
import { diagnosticsConfigSchema } from "../src/config/diagnostics.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { buildTracerouteCommand, parseTracerouteOutput, prepareTraceroute, tracerouteDiagnostic } from "../src/diagnostics/traceroute.js";
import type { DiagnosticDeviceRunner, DiagnosticObservation } from "../src/diagnostics/types.js";
import { tracerouteInputSchema } from "../src/mcp/tools/traceroute.js";
import {
  buildConfig, buildEapiSlots, buildHost, buildInventoryModel, echoRpcTransport, loadSwitchesModel, setTestPasswordEnv
} from "./helpers.js";

const settings = diagnosticsConfigSchema.parse({});

const answeringPath = `traceroute to 10.255.0.4 (10.255.0.4), 30 hops max, 60 byte packets
 1  10.255.255.0 (10.255.255.0)  0.033 ms  0.006 ms  0.005 ms
 2  10.255.0.4 (10.255.0.4)  1.452 ms  1.474 ms  1.666 ms
`;

const internetPath = `traceroute to 192.0.2.1 (192.0.2.1), 30 hops max, 60 byte packets
 1  _gateway (172.20.20.1)  0.060 ms  0.011 ms  0.009 ms
 2  192.168.68.1 (192.168.68.1)  0.359 ms  0.335 ms  0.361 ms
 3  10.112.235.250 (10.112.235.250)  12.277 ms 10.112.235.251 (10.112.235.251)  12.175 ms 10.112.235.250 (10.112.235.250)  12.428 ms
 6  96.108.99.245 (96.108.99.245)  15.190 ms 96.108.99.249 (96.108.99.249)  15.291 ms  15.260 ms
 7  96.110.41.73 (96.110.41.73)  15.205 ms !N 68.86.93.137 (68.86.93.137)  16.886 ms !N *
`;

const silentPath = `traceroute to 10.255.0.4 (10.255.0.4), 30 hops max, 60 byte packets\n${
  Array.from({ length: 30 }, (_, index) => `${String(index + 1).padStart(2, " ")}  * * *\n`).join("")}`;

const prepared = (destination = "10.255.0.4") => prepareTraceroute({ kind: "traceroute", destination });
const parse = (output: string) => parseTracerouteOutput(output);
const failureOf = (output: string) => {
  try {
    parse(output);
  } catch (error) {
    return error;
  }
  return undefined;
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("traceroute validation and command compilation", () => {
  it("builds the fixed-shape command with optional vrf and source, vrf first", () => {
    expect(buildTracerouteCommand(prepared())).toBe("traceroute ip 10.255.0.4");
    expect(buildTracerouteCommand(prepareTraceroute({ kind: "traceroute", destination: "10.255.0.4", source: "10.255.0.3", vrf: "MGMT" })))
      .toBe("traceroute vrf MGMT ip 10.255.0.4 source 10.255.0.3");
    expect(buildTracerouteCommand(prepareTraceroute({ kind: "traceroute", destination: "2001:db8::1", source: "2001:db8::2" })))
      .toBe("traceroute ipv6 2001:db8::1 source 2001:db8::2");
  });

  it("selects the command family for names from source, address_family, else IPv4", () => {
    const command = (request: Omit<Parameters<typeof prepareTraceroute>[0], "kind">) =>
      buildTracerouteCommand(prepareTraceroute({ kind: "traceroute", ...request }));
    expect(command({ destination: "leaf2" })).toBe("traceroute ip leaf2");
    expect(command({ destination: "leaf2", address_family: "ipv6" })).toBe("traceroute ipv6 leaf2");
    expect(command({ destination: "leaf2", source: "2001:db8::1" })).toBe("traceroute ipv6 leaf2 source 2001:db8::1");
  });

  it("rejects an address_family that contradicts source, and a source of another family than the destination", () => {
    expect(() => prepareTraceroute({ kind: "traceroute", destination: "leaf2", source: "192.0.2.1", address_family: "ipv6" }))
      .toThrow(expect.objectContaining({ code: "diagnostic_address_family_conflict" }));
    expect(() => prepareTraceroute({ kind: "traceroute", destination: "2001:db8::1", source: "192.0.2.1" }))
      .toThrow(expect.objectContaining({ code: "diagnostic_source_invalid" }));
  });

  it.each(["10.0.0.1;reload", "10.0.0.1\nshow version", "10.0.0.1 source 10.0.0.2", "224.0.0.1", "0.0.0.0", "fe80::1", "leaf2 interface Ethernet1", "-m"])(
    "rejects unsafe destination %j", (destination) => {
      expect(() => prepareTraceroute({ kind: "traceroute", destination })).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
    });

  it.each(["10.0.0.2 source x", "leaf1", "10.0.0.2\n", "224.0.0.1"])("rejects unsafe source %j", (source) => {
    expect(() => prepareTraceroute({ kind: "traceroute", destination: "10.255.0.4", source })).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
  });

  it.each(["x;reload", "x\nshow version", "x y", "-x", "x".repeat(65)])("rejects unsafe VRF %j", (vrf) => {
    expect(() => prepareTraceroute({ kind: "traceroute", destination: "10.255.0.4", vrf })).toThrow(expect.objectContaining({ code: "diagnostic_vrf_invalid" }));
  });

  it("rejects duplicates by canonical literal and by case-insensitive name", () => {
    for (const destinations of [["::1", "0:0:0:0:0:0:0:1"], ["Leaf2", "leaf2."], ["10.0.0.1", "10.0.0.1"]]) {
      expect(() => tracerouteDiagnostic.prepare({ kind: "traceroute", destinations }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_destination_duplicate" }));
    }
  });

  it("limits destinations to maxTracerouteDestinationsPerRequest, not ping's limit", () => {
    const destinations = (count: number) => Array.from({ length: count }, (_, index) => `10.0.0.${index + 1}`);
    expect(tracerouteDiagnostic.prepare({ kind: "traceroute", destinations: destinations(4) }, settings).executions).toHaveLength(4);
    expect(() => tracerouteDiagnostic.prepare({ kind: "traceroute", destinations: destinations(5) }, settings))
      .toThrow(expect.objectContaining({ code: "diagnostic_destination_limit_exceeded", message: "Provide between 1 and 4 destinations" }));
    expect(() => tracerouteDiagnostic.prepare({ kind: "traceroute", destinations: [] }, settings))
      .toThrow(expect.objectContaining({ code: "diagnostic_destination_limit_exceeded" }));
  });

  it("rejects unknown tool fields with guidance and accepts the documented ones", () => {
    const result = tracerouteInputSchema.safeParse({ target: "leaf1", destinations: ["10.0.0.1"], interface: "Ethernet1" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("eos_traceroute accepts target, destinations, vrf, source, address_family, and include_raw");
    expect(tracerouteInputSchema.parse({ target: "leaf1", destinations: ["10.0.0.1"] }).include_raw).toBe(false);
  });
});

describe("traceroute output interpretation", () => {
  it("parses an answering path as reached with per-probe addresses and RTTs", () => {
    expect(parse(answeringPath)).toEqual({
      kind: "traceroute", path: "reached", resolved_address: "10.255.0.4",
      hops: [
        { hop: 1, responses: [
          { address: "10.255.255.0", rtt_ms: 0.033 }, { address: "10.255.255.0", rtt_ms: 0.006 }, { address: "10.255.255.0", rtt_ms: 0.005 }
        ] },
        { hop: 2, responses: [
          { address: "10.255.0.4", rtt_ms: 1.452 }, { address: "10.255.0.4", rtt_ms: 1.474 }, { address: "10.255.0.4", rtt_ms: 1.666 }
        ] }
      ]
    });
  });

  it("models names, ECMP, repeated responders, mid-line silence and markers, and is unreached without the destination", () => {
    const finding = parse(internetPath);
    expect(finding.path).toBe("unreached");
    expect(finding.resolved_address).toBe("192.0.2.1");
    expect(finding.hops.map((hop) => hop.hop)).toEqual([1, 2, 3, 6, 7]);
    expect(finding.hops[0]?.responses[0]).toEqual({ address: "172.20.20.1", name: "_gateway", rtt_ms: 0.06 });
    expect(finding.hops[2]?.responses.map((response) => response?.address)).toEqual(["10.112.235.250", "10.112.235.251", "10.112.235.250"]);
    // A probe with only an RTT repeats the previous responder.
    expect(finding.hops[3]?.responses).toEqual([
      { address: "96.108.99.245", rtt_ms: 15.19 }, { address: "96.108.99.249", rtt_ms: 15.291 }, { address: "96.108.99.249", rtt_ms: 15.26 }
    ]);
    expect(finding.hops[4]?.responses).toEqual([
      { address: "96.110.41.73", rtt_ms: 15.205, marker: "!N" }, { address: "68.86.93.137", rtt_ms: 16.886, marker: "!N" }, null
    ]);
  });

  it("reports a fully silent path as unreached with 30 hops of null probes", () => {
    const finding = parse(silentPath);
    expect(finding.path).toBe("unreached");
    expect(finding.resolved_address).toBe("10.255.0.4");
    expect(finding.hops).toHaveLength(30);
    expect(finding.hops.every((hop) => hop.responses.length === 3 && hop.responses.every((response) => response === null))).toBe(true);
    expect(finding.hops[29]?.hop).toBe(30);
  });

  it("parses a name destination header and reverse names, taking the address from the parentheses", () => {
    const finding = parse("traceroute to localhost (127.0.0.1), 30 hops max, 60 byte packets\n 1  localhost.localdomain (127.0.0.1)  0.031 ms  0.006 ms  0.005 ms\n");
    expect(finding).toMatchObject({ path: "reached", resolved_address: "127.0.0.1" });
    expect(finding.hops[0]?.responses[0]).toEqual({ address: "127.0.0.1", name: "localhost.localdomain", rtt_ms: 0.031 });
  });

  it("parses IPv6 traces, comparing addresses canonically", () => {
    const finding = parse("traceroute to 2001:db8::1 (2001:db8::1), 30 hops max, 80 byte packets\n 1  r1 (2001:db8:0:0:0:0:0:1)  0.5 ms  0.4 ms  0.4 ms\n");
    expect(finding).toMatchObject({ path: "reached", resolved_address: "2001:db8::1" });
    expect(parse("traceroute to ::1 (::1), 30 hops max, 80 byte packets\n 1  ::1 (::1)  0.030 ms  0.004 ms  0.003 ms\n").path).toBe("reached");
  });

  it.each(["!H", "!N", "!P", "!S", "!F-1500", "!X", "!V", "!C", "!13", "!<10>"])("keeps marker %s and still counts the destination as reached", (marker) => {
    const finding = parse(`traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  10.0.0.1 (10.0.0.1)  1.0 ms  1.1 ms\n 2  10.0.0.9 (10.0.0.9)  2.0 ms ${marker}  2.1 ms ${marker} *\n`);
    expect(finding.path).toBe("reached");
    expect(finding.hops[1]?.responses).toEqual([
      { address: "10.0.0.9", rtt_ms: 2, marker }, { address: "10.0.0.9", rtt_ms: 2.1, marker }, null
    ]);
  });

  it("is reached when any probe of the last hop answers from the destination, even among silent or other responders", () => {
    expect(parse("traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  10.0.0.5 (10.0.0.5)  1 ms * 10.0.0.9 (10.0.0.9)  2 ms\n").path).toBe("reached");
  });

  it("is unreached when only an earlier hop was the destination or the last hop is another router", () => {
    expect(parse("traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  10.0.0.9 (10.0.0.9)  1 ms  1 ms  1 ms\n 2  * * *\n").path).toBe("unreached");
    expect(parse("traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  10.0.0.1 (10.0.0.1)  1 ms !H  1 ms !H  1 ms !H\n").path).toBe("unreached");
  });

  it.each(["not-an-ip", "10.0.0.999", "fe80::1%", "10.0.0.1%Ethernet1", "fe80::1%Ethernet 1"])(
    "fails a responder address %j that is not a valid IP as unrecognized, never as an unreached finding", (address) => {
      const output = `traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  r1 (${address})  1 ms  1 ms  1 ms\n`;
      expect(failureOf(output)).toMatchObject({ code: "diagnostic_output_unrecognized" });
    });

  it("keeps a scoped IPv6 responder as printed and compares scoped addresses without throwing", () => {
    const viaLinkLocal = parse("traceroute to 2001:db8::9 (2001:db8::9), 30 hops max, 80 byte packets\n" +
      " 1  fe80::1%Ethernet1 (fe80::1%Ethernet1)  1 ms  1 ms  1 ms\n 2  2001:db8::9 (2001:db8::9)  2 ms  2 ms  2 ms\n");
    expect(viaLinkLocal.path).toBe("reached");
    expect(viaLinkLocal.hops[0]?.responses[0]).toEqual({ address: "fe80::1%Ethernet1", rtt_ms: 1 });
    // A scoped last hop is a different address from an unscoped destination, so the path is unreached, not a crash.
    expect(parse("traceroute to 2001:db8::9 (2001:db8::9), 30 hops max, 80 byte packets\n 1  fe80::1%Ethernet1 (fe80::1%Ethernet1)  1 ms\n").path)
      .toBe("unreached");
    expect(parse("traceroute to fe80::9%Ethernet1 (fe80::9%Ethernet1), 30 hops max, 80 byte packets\n 1  fe80:0::9%Ethernet1 (fe80:0::9%Ethernet1)  1 ms\n").path)
      .toBe("reached");
    expect(parse("traceroute to fe80::9%Ethernet1 (fe80::9%Ethernet1), 30 hops max, 80 byte packets\n 1  fe80::9%Ethernet2 (fe80::9%Ethernet2)  1 ms\n").path)
      .toBe("unreached");
  });

  it("accepts CRLF output", () => {
    expect(parse(answeringPath.replaceAll("\n", "\r\n")).path).toBe("reached");
  });

  it("fails an unresolvable name as an execution failure, with no header", () => {
    expect(failureOf("node2-2: Name or service not known\n")).toMatchObject({ code: "diagnostic_destination_unresolved", message: "The device could not resolve the destination name" });
    expect(failureOf("localhost: Name or service not known\n")).toMatchObject({ code: "diagnostic_destination_unresolved" });
  });

  it("fails a wrong-family hostname as unresolved with a hint to change address_family", () => {
    expect(failureOf("leaf2: Address family for hostname not supported\n")).toMatchObject({
      code: "diagnostic_destination_unresolved", message: expect.stringContaining("address_family")
    });
  });

  it("fails no route as an execution failure, not an unreached finding", () => {
    expect(failureOf("traceroute to 203.0.113.9 (203.0.113.9), 30 hops max, 60 byte packets\nconnect: Network is unreachable\n"))
      .toMatchObject({ code: "diagnostic_destination_no_route" });
  });

  it("fails EOS % errors as command failures, even when they come with trace output", () => {
    expect(failureOf("% Invalid input (at token 3: 'vrf')\n")).toMatchObject({ code: "diagnostic_command_failed" });
    expect(failureOf(`% Destination IP address family for desintation does not match source\n${answeringPath}`)).toMatchObject({ code: "diagnostic_command_failed" });
  });

  it.each([
    "", "garbage\n", "traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n",
    "traceroute to nonsense\n 1  * * *\n", "traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\nweird line\n",
    "traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  1.5 ms\n",
    "traceroute to 10.0.0.9 (10.0.0.9), 30 hops max, 60 byte packets\n 1  10.0.0.1 (10.0.0.1)  1.0 ms bogus\n"
  ])("fails unparseable output %j as unrecognized", (output) => {
    expect(failureOf(output)).toMatchObject({ code: "diagnostic_output_unrecognized" });
  });
});

describe("traceroute execution lifecycle", () => {
  const call = { target: "switches", request: { kind: "traceroute" as const, destinations: ["10.255.0.4"] } };
  const observation: DiagnosticObservation = { end: "output", output: answeringPath };

  function singleSlotConfig() {
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    config.diagnostics.maxConcurrentDiagnostics = 1;
    return config;
  }

  it("returns one finding per host and destination, with raw output only on request", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async () => observation) };
    const executor = new DiagnosticExecutor(await loadSwitchesModel(), buildConfig(), device, buildEapiSlots());
    const result = await executor.execute({ ...call, request: { kind: "traceroute", destinations: ["10.255.0.4", "leaf2"], source: "10.255.0.3" } });
    expect(result.request).toEqual({ kind: "traceroute", destinations: ["10.255.0.4", "leaf2"], source: "10.255.0.3" });
    expect(result.summary).toEqual({ total_count: 4, success_count: 4, failed_count: 0 });
    expect(result.results.map((entry) => [entry.inventory_hostname, entry.destination, entry.finding?.kind])).toEqual([
      ["leaf1", "10.255.0.4", "traceroute"], ["leaf1", "leaf2", "traceroute"],
      ["leaf2", "10.255.0.4", "traceroute"], ["leaf2", "leaf2", "traceroute"]
    ]);
    expect(result.results.every((entry) => !("raw_output" in entry))).toBe(true);
    expect((await executor.execute({ ...call, includeRaw: true })).results[0]?.raw_output).toBe(answeringPath);
  });

  it("reports reached and unreached paths as successes and isolates one destination's failure from the others", async () => {
    const silentDestination = "10.255.0.9";
    const unresolvableName = "nosuch.example";
    const outputByDestination = new Map<string, string>([
      ["10.255.0.4", answeringPath],
      [silentDestination, silentPath.replace("10.255.0.4 (10.255.0.4)", `${silentDestination} (${silentDestination})`)],
      [unresolvableName, `${unresolvableName}: Name or service not known\n`]
    ]);
    const device = {
      execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async (_host, request) => {
        const destination = request.kind === "traceroute" ? request.destination : "";
        return { end: "output", output: outputByDestination.get(destination) ?? "" };
      })
    };
    const executor = new DiagnosticExecutor(await loadSwitchesModel(), buildConfig(), device, buildEapiSlots());
    const result = await executor.execute({
      target: "leaf1",
      request: { kind: "traceroute", destinations: ["10.255.0.4", silentDestination, unresolvableName] }
    });

    expect(result.summary).toEqual({ total_count: 3, success_count: 2, failed_count: 1 });
    const entryFor = (destination: string) => result.results.find((entry) => entry.destination === destination);
    expect(entryFor("10.255.0.4")).toMatchObject({
      status: "success", finding: { kind: "traceroute", path: "reached", resolved_address: "10.255.0.4" }
    });
    // An unreached path is a completed execution with a finding, not a tool failure.
    expect(entryFor(silentDestination)).toMatchObject({
      status: "success", finding: { kind: "traceroute", path: "unreached", resolved_address: silentDestination }
    });
    expect(entryFor(silentDestination)?.finding).toMatchObject({ hops: expect.arrayContaining([{ hop: 30, responses: [null, null, null] }]) });
    expect(entryFor(unresolvableName)).toMatchObject({ status: "failed", error_code: "diagnostic_destination_unresolved" });
    expect(entryFor(unresolvableName)).not.toHaveProperty("finding");
    expect(device.execute).toHaveBeenCalledTimes(3);
  });

  it("denies the whole request before dispatch when a host lacks diagnostic permission", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async () => observation) };
    const model = await loadSwitchesModel({ leaf2Vars: ["mcp_diagnostics_allowed: false"] });
    await expect(new DiagnosticExecutor(model, buildConfig(), device, buildEapiSlots()).execute(call))
      .rejects.toMatchObject({ code: "diagnostic_policy_denied", message: "Diagnostic permission denied for: leaf2" });
    expect(device.execute).not.toHaveBeenCalled();
  });

  it("budgets hosts times destinations against maxTracesPerRequest, one per execution, independent of the probe budget", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async () => observation) };
    const config = buildConfig();
    config.diagnostics.maxProbesPerRequest = 1;
    config.diagnostics.maxTracesPerRequest = 4;
    const executor = new DiagnosticExecutor(await loadSwitchesModel(), config, device, buildEapiSlots(config));
    const request = { kind: "traceroute" as const, destinations: ["10.0.0.1", "10.0.0.2"] };
    expect((await executor.execute({ target: "switches", request })).summary.success_count).toBe(4);
    config.diagnostics.maxTracesPerRequest = 3;
    await expect(executor.execute({ target: "switches", request }))
      .rejects.toMatchObject({ code: "diagnostic_trace_limit_exceeded", message: "Request exceeds maxTracesPerRequest 3" });
    expect(device.execute).toHaveBeenCalledTimes(4);
  });

  it("fails a trace the device timer stopped, frees its slot at once, and explains slow reverse DNS", async () => {
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>()
      .mockResolvedValueOnce({ end: "device_time_limit" })
      .mockResolvedValue(observation) };
    const config = singleSlotConfig();
    const executor = new DiagnosticExecutor(await loadSwitchesModel(), config, device, buildEapiSlots(config));
    const limited = await executor.execute({ ...call, target: "leaf1", includeRaw: true });
    expect(limited.summary).toEqual({ total_count: 1, success_count: 0, failed_count: 1 });
    expect(limited.results[0]).toMatchObject({
      status: "failed", error_code: "traceroute_device_time_limit_reached", destination: "10.255.0.4",
      message: expect.stringMatching(/tracerouteTimeoutMs.*no hops are returned.*reverse DNS/s)
    });
    expect(limited.results[0]).not.toHaveProperty("raw_output");
    expect(executor.getCapacity()).toMatchObject({ available_count: 1, active_count: 0, uncertain_count: 0, reservations: [] });
    expect((await executor.execute({ ...call, target: "leaf1" })).results[0]).toMatchObject({ status: "success" });
  });

  it("holds an uncertain trace's slot for tracerouteTimeoutMs, shown as a traceroute reservation", async () => {
    vi.useFakeTimers();
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>()
      .mockRejectedValueOnce(new AppError("eapi_transport_error", "lost response"))
      .mockResolvedValue(observation) };
    const config = singleSlotConfig();
    config.diagnostics.tracerouteTimeoutMs = 20_000;
    config.diagnostics.tracerouteOverallOperationTimeoutMs = 60_000;
    const executor = new DiagnosticExecutor(await loadSwitchesModel(), config, device, buildEapiSlots(config));
    expect((await executor.execute({ ...call, target: "leaf1" })).results[0]).toMatchObject({ status: "failed", error_code: "eapi_transport_error" });
    const capacity = executor.getCapacity();
    expect(capacity).toMatchObject({
      available_count: 0, uncertain_count: 1,
      reservations: [{ inventory_hostname: "leaf1", diagnostic: "traceroute", state: "uncertain", reason_code: "eapi_transport_error" }]
    });
    const reservation = capacity.reservations[0];
    expect(Date.parse(reservation?.releases_at ?? "") - Date.parse(reservation?.uncertain_since ?? "")).toBe(20_000);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(executor.getCapacity()).toMatchObject({ uncertain_count: 0, available_count: 1 });
  });

  it("bounds the whole call by tracerouteOverallOperationTimeoutMs rather than ping's deadline", async () => {
    vi.useFakeTimers();
    const device = { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(() => new Promise<never>(() => undefined)) };
    const config = buildConfig();
    config.diagnostics.overallOperationTimeoutMs = 50;
    config.diagnostics.tracerouteOverallOperationTimeoutMs = 20_000;
    let settled = false;
    const pending = new DiagnosticExecutor(await loadSwitchesModel(), config, device, buildEapiSlots(config)).execute(call).finally(() => { settled = true; });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "operation_timeout", message: "eos_traceroute exceeded diagnostics.tracerouteOverallOperationTimeoutMs 20000"
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
  });

  it("shares deviceConcurrency with other diagnostics: no traceroute-specific per-device limit", () => {
    expect(tracerouteDiagnostic.perDeviceLimit).toBeUndefined();
  });
});

describe("traceroute eAPI plan", () => {
  const host = buildHost({ effectiveVars: { ansible_user: "admin", ansible_password: "test-password" } });
  const context = () => ({ shutdownSignal: new AbortController().signal, requestId: "unit-rpc-id" });
  const okTransport = (postJson: ReturnType<typeof vi.fn<EapiTransport["postJson"]>>) =>
    postJson.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ result: [{ output: answeringPath }] }), text: async () => "" }));

  it.each([true, false])("always sends tracerouteTimeoutMs as the EOS request timeout and outlasts it by 5 s (nativeRequestTimeout %s)", async (nativeRequestTimeout) => {
    const postJson = vi.fn<EapiTransport["postJson"]>();
    okTransport(postJson);
    const config = buildConfig({ eapiVersion: 1 });
    config.diagnostics.nativeRequestTimeout = nativeRequestTimeout;
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    const request = prepareTraceroute({ kind: "traceroute", destination: "10.255.0.4", source: "10.255.0.3", vrf: "default" });
    expect(await runner.execute(host, request, context())).toEqual({ end: "output", output: answeringPath });
    const [connection, body] = postJson.mock.calls[0] ?? [];
    expect(connection).toMatchObject({ timeoutMs: 50_000 });
    expect(JSON.parse(String(body)).params).toEqual({
      version: 1, format: "text", cmds: ["traceroute vrf default ip 10.255.0.4 source 10.255.0.3"], requestTimeout: 45
    });
  });

  it("follows a configured tracerouteTimeoutMs", async () => {
    const postJson = vi.fn<EapiTransport["postJson"]>();
    okTransport(postJson);
    const config = buildConfig();
    config.diagnostics.tracerouteTimeoutMs = 60_000;
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    await runner.execute(host, prepared(), context());
    const [connection, body] = postJson.mock.calls[0] ?? [];
    expect(connection).toMatchObject({ timeoutMs: 65_000 });
    expect(JSON.parse(String(body)).params.requestTimeout).toBe(60);
  });

  // Measured on cEOS 4.34.3M: traceroute sent alone and stopped by its timer answers with one entry.
  const timeLimitReply = (data: unknown[]) => vi.fn<EapiTransport["postJson"]>(async () => ({
    ok: true, status: 200, text: async () => "",
    json: async () => ({ error: { code: 1001, message: "CLI command 1 of 1 'traceroute ip 10.255.0.4' failed: unexpected error 408", data } })
  }));

  it("recognizes EOS's device-time-limit reply for the unprivileged command (RPC 1001, the timed-out command alone)", async () => {
    const config = buildConfig();
    const postJson = timeLimitReply([{ errors: ["Command exceeded its allowed time limit"] }]);
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    expect(await runner.execute(host, prepared(), context())).toEqual({ end: "device_time_limit" });
    expect(JSON.parse(String(postJson.mock.calls[0]?.[1])).params.cmds).toEqual(["traceroute ip 10.255.0.4"]);
  });

  it("treats a timer reply shaped for a different command sequence as unknown completion", async () => {
    const config = buildConfig();
    const postJson = timeLimitReply([{ output: "" }, { errors: ["Command exceeded its allowed time limit"] }]);
    const runner = new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson })));
    expect(await runner.execute(host, prepared(), context())).toMatchObject({ end: "failed", remote: "unknown" });
  });

  it("runs end to end through the executor, naming the failure for a device timer", async () => {
    setTestPasswordEnv();
    const postJson = vi.fn<EapiTransport["postJson"]>(async () => ({
      ok: true, status: 200, text: async () => "",
      json: async () => ({ error: { code: 1001, message: "unexpected error 408", data: [{ errors: ["Command exceeded its allowed time limit"] }] } })
    }));
    const config = buildConfig();
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true, effectiveVars: host.effectiveVars }), config,
      new EapiDiagnosticRunner(config, new EapiClient(echoRpcTransport({ postJson }))), buildEapiSlots(config));
    const result = await executor.execute({ target: "leaf1", request: { kind: "traceroute", destinations: ["10.255.0.4"] } });
    expect(result.results[0]).toMatchObject({ status: "failed", error_code: "traceroute_device_time_limit_reached" });
  });
});
