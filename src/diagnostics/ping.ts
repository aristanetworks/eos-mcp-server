import { isIP } from "node:net";
import type { DiagnosticsConfig } from "../config/diagnostics.js";
import { pingExecutionBoundMs } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import type { DiagnosticDefinition, PingFinding, PingRequest, PreparedPing } from "./types.js";

export const pingDiagnostic: DiagnosticDefinition = {
  prepare(request, config) {
    const execution = preparePing(request, config);
    return { request: { ...request, count: execution.count }, executions: [execution] };
  },
  probeCount: (execution) => execution.count,
  interpret: (output, execution) => parsePingOutput(output, execution.count)
};

export function preparePing(request: PingRequest, config: DiagnosticsConfig): PreparedPing {
  const addressFamily = validateAddress(request.destination);
  const count = request.count ?? config.defaultPingCount;
  if (!Number.isSafeInteger(count) || count < 1 || count > config.maxPingCount) {
    throw new AppError("diagnostic_count_invalid", `Ping count must be between 1 and ${config.maxPingCount}`);
  }
  if (pingExecutionBoundMs(count, config.pingReplyTimeoutMs) > config.commandTimeoutMs) {
    throw new AppError("diagnostic_command_budget_exceeded", "Ping exceeds the configured device command budget");
  }
  if (request.vrf !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/.test(request.vrf)) {
    throw new AppError("diagnostic_vrf_invalid", "VRF must be a single safe identifier (1-64 characters)");
  }
  if (request.source !== undefined && validateAddress(request.source) !== addressFamily) {
    throw new AppError("diagnostic_source_invalid", "Source and destination must use the same IP address family");
  }
  return { ...request, count, addressFamily, replyTimeoutSeconds: config.pingReplyTimeoutMs / 1000 };
}

function validateAddress(address: string): 4 | 6 {
  const family = isIP(address);
  if (family === 0 || address.includes("%")) {
    throw new AppError("diagnostic_address_invalid", "Use an IPv4 or IPv6 literal without interface scoping");
  }
  if (family === 4) {
    validateIpv4(address.split(".").map(Number));
    return 4;
  }
  // WHATWG URL canonicalization expands dotted IPv4-mapped IPv6 into hex words.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const halves = canonical.split("::");
  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  const words = halves.length === 1
    ? left.map((word) => Number.parseInt(word, 16))
    : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((word) => Number.parseInt(word, 16));
  const first = words[0] ?? 0;
  if (words.every((word) => word === 0) || (first & 0xff00) === 0xff00 || (first & 0xffc0) === 0xfe80) {
    throw new AppError("diagnostic_address_invalid", "Unspecified, multicast, and IPv6 link-local addresses are not supported");
  }
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    // Prevent mapped addresses from bypassing IPv4 destination restrictions.
    const high = words[6] ?? 0;
    const low = words[7] ?? 0;
    validateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  return 6;
}

function validateIpv4(octets: number[]): void {
  if ((octets[0] ?? 0) === 0 || (octets[0] ?? 0) >= 224) {
    throw new AppError("diagnostic_address_invalid", "Unspecified, multicast, reserved, and limited broadcast addresses are not supported");
  }
}

/** Verified on cEOS 4.34.3M. `timeout` is per-reply, not a wall-clock deadline. */
export function buildPingCommand(request: PreparedPing): string {
  return [
    "ping",
    ...(request.vrf === undefined ? [] : ["vrf", request.vrf]),
    request.addressFamily === 6 ? "ipv6" : "ip",
    request.destination,
    ...(request.source === undefined ? [] : ["source", request.source]),
    "repeat", String(request.count),
    "timeout", String(request.replyTimeoutSeconds),
    "interval", "1",
    "size", "64"
  ].join(" ");
}

export function parsePingOutput(output: string, expectedCount: number): PingFinding {
  const normalized = output.replace(/\r\n/g, "\n");
  if (/^(?:ping6?:|%)/m.test(normalized)) {
    throw new AppError("diagnostic_command_failed", "EOS could not execute the requested ping");
  }
  const matches = [...normalized.matchAll(/^(\d+) packets transmitted, (\d+)(?: packets)? received,(?: \+\d+ (?:errors|duplicates),)* ([\d.]+)% packet loss[^\r\n]*$/gm)];
  const stats = matches.length === 1 ? matches[0] : undefined;
  if (!stats) {
    throw new AppError("diagnostic_output_unrecognized", "EOS ping output did not contain one recognized packet summary");
  }
  const sent = Number(stats[1]);
  const received = Number(stats[2]);
  const reportedLoss = Number(stats[3]);
  const loss = 100 * (sent - received) / sent;
  if (sent < 1 || !Number.isSafeInteger(sent) || sent !== expectedCount || !Number.isSafeInteger(received) || received < 0 || received > sent ||
      !Number.isFinite(reportedLoss) || reportedLoss < 0 || reportedLoss > 100 || Math.abs(reportedLoss - loss) > 1) {
    throw new AppError("diagnostic_output_unrecognized", "EOS ping packet summary was incomplete or inconsistent");
  }
  const timing = /^(?:rtt|round-trip) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)\/[\d.]+ ms/m.exec(normalized);
  if (/^(?:rtt|round-trip) /m.test(normalized) && timing === null) {
    throw new AppError("diagnostic_output_unrecognized", "EOS ping RTT summary was not recognized");
  }
  let rtt: PingFinding["rtt_ms"] = null;
  if (timing) {
    const min = Number(timing[1]);
    const avg = Number(timing[2]);
    const max = Number(timing[3]);
    if (received === 0 || ![min, avg, max].every(Number.isFinite) || min < 0 || min > avg || avg > max) {
      throw new AppError("diagnostic_output_unrecognized", "EOS ping RTT summary was inconsistent");
    }
    rtt = { min, avg, max };
  }
  return {
    kind: "ping",
    reachability: received === 0 ? "unreachable" : received === sent ? "reachable" : "partial",
    packets_sent: sent,
    packets_received: received,
    packet_loss_percent: Number(loss.toFixed(4)),
    rtt_ms: rtt
  };
}
