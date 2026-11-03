import { captureHttpTimeoutMs, captureUncertainHoldMs, type DiagnosticsConfig } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import { resolveBoundedInteger, validateVrf } from "./validation.js";
import type { DiagnosticDefinition, PacketCaptureFinding, PacketCaptureRequest, PreparedPacketCapture } from "./types.js";

// Full canonical names only: EOS abbreviations, `fabric` (whose view differs between cEOS and
// hardware), and `Cpu` (unsupported on cEOS) are not offered (ADR 0010).
const CAPTURE_INTERFACE_PATTERN =
  /^(?:Ethernet\d+(?:\/\d+){0,2}(?:\.\d+)?|Management\d+(?:\/\d+)?|Loopback\d+|Port-Channel\d+(?:\.\d+)?|(?:Vlan|Tunnel|Vxlan)\d+|any)$/;

const MAX_FILTER_LENGTH = 4096;

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
  budget: {
    cost: (execution) => execution.packet_count,
    limit: (config) => config.maxCapturePacketsPerRequest,
    limitName: "maxCapturePacketsPerRequest",
    exceededCode: "packet_capture_packet_limit_exceeded"
  },
  overallOperationTimeoutMs: (config) => config.captureOverallOperationTimeoutMs,
  // The device timer is what ends a capture short of its count, so it is never optional (ADR 0010).
  eapiExecution: (execution) => ({
    command: buildPacketCaptureCommand(execution),
    httpTimeoutMs: captureHttpTimeoutMs(execution.window_seconds),
    requestTimeoutSeconds: execution.window_seconds
  }),
  uncertainHoldMs: (execution) => captureUncertainHoldMs(execution.window_seconds),
  resultIdentity: () => ({}),
  // The device timer is the expected end of a capture that does not fill, so it is a finding, not a failure (ADR 0010).
  interpret: (observation, execution) => "output" in observation
    ? interpretPacketCaptureOutput(observation.output, execution)
    : { kind: "packet_capture", capture: "unfilled", requested_packet_count: execution.packet_count, window_seconds: execution.window_seconds, packets: [] }
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
  const packetCount = resolveBoundedInteger(request.packet_count, config.defaultCapturePacketCount, config.maxCapturePacketCount,
    { code: "packet_capture_count_invalid", label: "Packet count" });
  const windowSeconds = resolveBoundedInteger(request.window_seconds, config.defaultCaptureWindowSeconds, config.maxCaptureWindowSeconds,
    { code: "packet_capture_window_invalid", label: "Window", unit: "seconds" });
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
  // EOS does not check pcap-filter syntax, and eAPI drops tcpdump's stderr, so a successful response
  // without packets means tcpdump exited before capturing. It is never an unfilled finding (ADR 0010).
  if (packets.length === 0) {
    throw new AppError("packet_capture_filter_rejected",
      `tcpdump exited without capturing: the filter is probably not valid pcap-filter syntax, or interface ${request.interface} cannot be captured on`);
  }
  return {
    kind: "packet_capture",
    capture: "complete",
    requested_packet_count: request.packet_count,
    window_seconds: request.window_seconds,
    packets
  };
}
