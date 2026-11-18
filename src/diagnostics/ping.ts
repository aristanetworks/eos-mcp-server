import { isIP } from "node:net";
import type { DiagnosticsConfig } from "../config/diagnostics.js";
import { pingExecutionBoundMs } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import { destinationKey, throwOnDestinationFailure, parseDestination, resolveDestinationFamily, validateAddress, validateAddressFamilyAgainstSource } from "./destination.js";
import { resolveBoundedInteger, validateVrf } from "./validation.js";
import type { DiagnosticDefinition, PingExecutionRequest, PingFinding, PingRequest, PreparedPing } from "./types.js";

export const pingDiagnostic: DiagnosticDefinition<PingRequest, PreparedPing> = {
  permission: {
    allows: (host) => host.diagnosticsAllowed,
    deniedCode: "diagnostic_policy_denied",
    deniedMessage: "Diagnostic permission denied for"
  },
  prepare(request, config) {
    const { destinations, ...shared } = request;
    if (destinations.length === 0 || destinations.length > config.maxDestinationsPerRequest) {
      throw new AppError("diagnostic_destination_limit_exceeded", `Provide between 1 and ${config.maxDestinationsPerRequest} destinations`);
    }
    // Every destination is validated before any is dispatched.
    const executions = destinations.map((destination) => preparePing({ ...shared, destination }, config));
    // Literals compare canonically (alternate IPv6 spellings); names ignore case and a trailing dot.
    if (new Set(executions.map((execution) => destinationKey(parseDestination(execution.destination)))).size !== executions.length) {
      throw new AppError("diagnostic_destination_duplicate", "Each destination may appear only once per request");
    }
    const count = executions[0]?.count ?? config.defaultPingCount;
    return { request: { ...request, count }, executions };
  },
  budget: {
    cost: (execution) => execution.count,
    limit: (config) => config.maxProbesPerRequest,
    limitName: "maxProbesPerRequest",
    exceededCode: "diagnostic_probe_limit_exceeded"
  },
  deadline: (config) => ({ ms: config.overallOperationTimeoutMs, settingName: "diagnostics.overallOperationTimeoutMs" }),
  eapiExecution: (execution, config) => ({
    command: buildPingCommand(execution),
    httpTimeoutMs: config.httpTimeoutMs,
    // Lets EOS stop the command itself at the same budget the server holds an uncertain slot for.
    ...(config.nativeRequestTimeout ? { requestTimeoutSeconds: config.commandTimeoutMs / 1000 } : {})
  }),
  uncertainHoldMs: (_execution, config) => config.commandTimeoutMs,
  resultIdentity: (execution) => ({ destination: execution.destination }),
  interpret: (observation, execution) => {
    // EOS stopped the ping and returned none of its output, so there is no reachability to report.
    // The device's reply confirms the ping has ended, so its slot is freed (measured on cEOS 4.34.3M).
    if (observation.end === "device_time_limit") {
      throw new AppError("ping_device_time_limit_reached",
        "EOS stopped the ping at its request timer (commandTimeoutMs) before it finished; no reachability was observed");
    }
    return parsePingOutput(observation.output, execution.count);
  }
};

export function preparePing(request: PingExecutionRequest, config: DiagnosticsConfig): PreparedPing {
  const destination = parseDestination(request.destination);
  const sourceFamily = request.source === undefined ? undefined : validateAddress(request.source);
  validateAddressFamilyAgainstSource(request.address_family, sourceFamily);
  const addressFamily = resolveDestinationFamily(destination, { sourceFamily, addressFamily: request.address_family });
  const count = resolveBoundedInteger(request.count, config.defaultPingCount, config.maxPingCount, { code: "diagnostic_count_invalid", label: "Ping count" });
  if (pingExecutionBoundMs(count, config.pingReplyTimeoutMs) > config.commandTimeoutMs) {
    throw new AppError("diagnostic_command_budget_exceeded", "Ping exceeds the configured device command budget");
  }
  if (request.vrf !== undefined) validateVrf(request.vrf);
  if (sourceFamily !== undefined && sourceFamily !== addressFamily) {
    throw new AppError("diagnostic_source_invalid", "Source and destination must use the same IP address family");
  }
  return { ...request, count, addressFamily, replyTimeoutSeconds: config.pingReplyTimeoutMs / 1000 };
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
  throwOnDestinationFailure(normalized, "ping6?: ");
  if (/^(?:ping6?:|%)/m.test(normalized)) {
    throw new AppError("diagnostic_command_failed", "EOS could not execute the requested ping");
  }
  const resolvedAddress = parseResolvedAddress(normalized);
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
    resolved_address: resolvedAddress,
    reachability: received === 0 ? "unreachable" : received === sent ? "reachable" : "partial",
    packets_sent: sent,
    packets_received: received,
    packet_loss_percent: Number(loss.toFixed(4)),
    rtt_ms: rtt
  };
}

/** The Resolved Address from EOS's header. Measured on cEOS 4.34.3M:
 * `PING 10.255.0.4 (10.255.0.4) from 10.255.0.3 : 72(100) bytes of data.`,
 * `PING localhost.localdomain (127.0.0.1) 72(100) bytes of data.` and `PING ::1(::1) 52 data bytes`.
 * The name shown may be the canonical name rather than the one requested, so only the parenthesized address is used.
 * A name-bearing IPv6 header is expected to nest it, as `PING name(name (addr)) ...`, so the innermost group wins.
 */
function parseResolvedAddress(normalizedOutput: string): string {
  const header = /^PING [^\n]*$/m.exec(normalizedOutput)?.[0];
  const candidate = header === undefined ? undefined : /\(([^()\s]+)\)/.exec(header)?.[1];
  if (candidate === undefined || isIP(candidate) === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS ping output did not contain a recognized resolved address");
  }
  return candidate;
}
