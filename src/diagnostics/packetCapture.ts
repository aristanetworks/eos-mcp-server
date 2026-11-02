import type { DiagnosticsConfig } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import { validateVrf } from "./ping.js";
import type { DiagnosticDefinition, PacketCaptureFinding, PacketCaptureRequest, PreparedPacketCapture } from "./types.js";

// Full canonical names only: EOS abbreviations, `fabric` (whose view differs between cEOS and
// hardware), and `Cpu` (unsupported on cEOS) are not offered (ADR 0010).
const CAPTURE_INTERFACE_PATTERN =
  /^(?:Ethernet\d+(?:\/\d+){0,2}(?:\.\d+)?|Management\d+(?:\/\d+)?|Loopback\d+|Port-Channel\d+(?:\.\d+)?|(?:Vlan|Tunnel|Vxlan)\d+|any)$/;

const MAX_FILTER_LENGTH = 4096;
// The device timer ends a capture at its window; the HTTP request waits this much longer for its answer.
const HTTP_TIMEOUT_MARGIN_MS = 5000;
const UNCERTAIN_HOLD_MARGIN_MS = 2000;

/** One capture per resolved host, all with the same interface, VRF, and filter. */
export const packetCaptureDiagnostic: DiagnosticDefinition<PacketCaptureRequest, PreparedPacketCapture> = {
  permission: {
    allows: (host) => host.packetCaptureAllowed,
    deniedCode: "packet_capture_policy_denied",
    deniedMessage: "Packet capture permission denied for"
  },
  prepare(request, config) {
    const execution = preparePacketCapture(request, config);
    return { request: execution, executions: [execution] };
  },
  enforceBudget(hostCount, executions, config) {
    const packetsPerHost = executions.reduce((total, execution) => total + execution.packet_count, 0);
    if (hostCount * packetsPerHost > config.maxCapturePacketsPerRequest) {
      throw new AppError("packet_capture_packet_limit_exceeded", `Request exceeds maxCapturePacketsPerRequest ${config.maxCapturePacketsPerRequest}`);
    }
  },
  overallOperationTimeoutMs: (config) => config.captureOverallOperationTimeoutMs,
  // The device timer ends the capture at its window, so an uncertain one need not wait out commandTimeoutMs.
  uncertainHoldMs: (execution) => execution.window_seconds * 1000 + UNCERTAIN_HOLD_MARGIN_MS,
  resultIdentity: () => ({}),
  interpret: interpretPacketCaptureOutput
};

export function preparePacketCapture(request: PacketCaptureRequest, config: DiagnosticsConfig): PreparedPacketCapture {
  if (!CAPTURE_INTERFACE_PATTERN.test(request.interface)) {
    throw new AppError("packet_capture_interface_invalid",
      "Interface must be a full EOS Ethernet, Management, Loopback, Port-Channel, Vlan, Tunnel, or Vxlan name, or any");
  }
  if (request.vrf !== undefined) {
    // EOS accepts `vrf` only after `interface any`.
    if (request.interface !== "any") {
      throw new AppError("packet_capture_vrf_requires_any", "VRF is only accepted with interface any");
    }
    validateVrf(request.vrf);
  }
  // EOS passes the filter to tcpdump as one argument without a shell; a line break would end the command.
  if (request.filter !== undefined &&
      (request.filter.trim() === "" || request.filter.length > MAX_FILTER_LENGTH || /[\u0000-\u001f\u007f]/.test(request.filter))) {
    throw new AppError("packet_capture_filter_invalid",
      `Filter must be a non-blank pcap-filter expression of at most ${MAX_FILTER_LENGTH} characters without control characters`);
  }
  const packetCount = request.packet_count ?? config.defaultCapturePacketCount;
  if (!Number.isSafeInteger(packetCount) || packetCount < 1 || packetCount > config.maxCapturePacketCount) {
    throw new AppError("packet_capture_count_invalid", `Packet count must be between 1 and ${config.maxCapturePacketCount}`);
  }
  const windowSeconds = request.window_seconds ?? config.defaultCaptureWindowSeconds;
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > config.maxCaptureWindowSeconds) {
    throw new AppError("packet_capture_window_invalid", `Window must be between 1 and ${config.maxCaptureWindowSeconds} seconds`);
  }
  return { ...request, packet_count: packetCount, window_seconds: windowSeconds };
}

/** Verified on cEOS 4.34.3M. `filter` consumes the rest of the line, so it must stay last. */
export function buildPacketCaptureCommand(request: PreparedPacketCapture): string {
  return [
    "tcpdump",
    "interface", request.interface,
    ...(request.vrf === undefined ? [] : ["vrf", request.vrf]),
    "packet-count", String(request.packet_count),
    ...(request.filter === undefined ? [] : ["filter", request.filter])
  ].join(" ");
}

/** Packets in a successful response mean the count was reached; the device timer ends an unfilled capture with an error instead. */
export function interpretPacketCaptureOutput(output: string, request: PreparedPacketCapture): PacketCaptureFinding {
  const packets = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (packets.length === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS returned no captured packets");
  }
  return {
    kind: "packet_capture",
    capture: "complete",
    requested_packet_count: request.packet_count,
    window_seconds: request.window_seconds,
    packets
  };
}

export function packetCaptureHttpTimeoutMs(request: PreparedPacketCapture): number {
  return request.window_seconds * 1000 + HTTP_TIMEOUT_MARGIN_MS;
}
