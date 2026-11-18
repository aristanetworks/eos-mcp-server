import { isIP } from "node:net";
import { tracerouteHttpTimeoutMs } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import {
  canonicalAddress,
  destinationKey,
  parseDestination,
  resolveDestinationFamily,
  throwOnDestinationFailure,
  validateAddress,
  validateAddressFamilyAgainstSource
} from "./destination.js";
import { validateVrf } from "./validation.js";
import type {
  DiagnosticDefinition,
  PreparedTraceroute,
  TracerouteExecutionRequest,
  TracerouteFinding,
  TracerouteHop,
  TracerouteRequest,
  TracerouteResponse
} from "./types.js";

/** One trace per destination and host. It has its own timer, budget and deadline (ADR 0013). */
export const tracerouteDiagnostic: DiagnosticDefinition<TracerouteRequest, PreparedTraceroute> = {
  permission: {
    allows: (host) => host.diagnosticsAllowed,
    deniedCode: "diagnostic_policy_denied",
    deniedMessage: "Diagnostic permission denied for"
  },
  prepare(request, config) {
    const { destinations, ...shared } = request;
    if (destinations.length === 0 || destinations.length > config.maxTracerouteDestinationsPerRequest) {
      throw new AppError("diagnostic_destination_limit_exceeded", `Provide between 1 and ${config.maxTracerouteDestinationsPerRequest} destinations`);
    }
    // Every destination is validated before any is dispatched.
    const executions = destinations.map((destination) => prepareTraceroute({ ...shared, destination }));
    if (new Set(executions.map((execution) => destinationKey(parseDestination(execution.destination)))).size !== executions.length) {
      throw new AppError("diagnostic_destination_duplicate", "Each destination may appear only once per request");
    }
    return { request, executions };
  },
  budget: {
    cost: () => 1,
    limit: (config) => config.maxTracesPerRequest,
    limitName: "maxTracesPerRequest",
    exceededCode: "diagnostic_trace_limit_exceeded"
  },
  deadline: (config) => ({ ms: config.tracerouteOverallOperationTimeoutMs, settingName: "diagnostics.tracerouteOverallOperationTimeoutMs" }),
  // The device timer is never optional: a silent path takes about 30 s and a dead name server can hold a trace for minutes (ADR 0013).
  eapiExecution: (execution, config) => ({
    command: buildTracerouteCommand(execution),
    httpTimeoutMs: tracerouteHttpTimeoutMs(config.tracerouteTimeoutMs),
    requestTimeoutSeconds: config.tracerouteTimeoutMs / 1000
  }),
  uncertainHoldMs: (_execution, config) => config.tracerouteTimeoutMs,
  resultIdentity: (execution) => ({ destination: execution.destination }),
  interpret: (observation) => {
    // EOS returns none of the hops it found when its timer fires, so there is no path to report.
    if (observation.end === "device_time_limit") {
      throw new AppError("traceroute_device_time_limit_reached",
        "EOS stopped the traceroute at its request timer (tracerouteTimeoutMs) before it finished; no hops are returned. " +
        "When the path is short, slow reverse DNS on the device is a likely cause, because EOS looks up every responding hop address");
    }
    return parseTracerouteOutput(observation.output);
  }
};

export function prepareTraceroute(request: TracerouteExecutionRequest): PreparedTraceroute {
  const destination = parseDestination(request.destination);
  const sourceFamily = request.source === undefined ? undefined : validateAddress(request.source);
  validateAddressFamilyAgainstSource(request.address_family, sourceFamily);
  const addressFamily = resolveDestinationFamily(destination, { sourceFamily, addressFamily: request.address_family });
  if (request.vrf !== undefined) validateVrf(request.vrf);
  if (sourceFamily !== undefined && sourceFamily !== addressFamily) {
    throw new AppError("diagnostic_source_invalid", "Source and destination must use the same IP address family");
  }
  return { ...request, addressFamily };
}

/** Verified on cEOS 4.34.3M. EOS fixes hop count, probes and wait; `vrf` goes before the family. */
export function buildTracerouteCommand(request: PreparedTraceroute): string {
  return [
    "traceroute",
    ...(request.vrf === undefined ? [] : ["vrf", request.vrf]),
    request.addressFamily === 6 ? "ipv6" : "ip",
    request.destination,
    ...(request.source === undefined ? [] : ["source", request.source])
  ].join(" ");
}

// Measured on cEOS 4.34.3M, plus Linux traceroute's marker set (!H !N !P !S !F-<n> !X !V !C !<num>).
const HOP_LINE_PATTERN = /^\s*(\d{1,3})\s+(\S.*)$/;
const PROBE_PATTERN = /\s*(?:(\*)|(\S+) \(([^()\s]+)\)\s+(\d+(?:\.\d+)?) ms|(\d+(?:\.\d+)?) ms)(?:\s+(![A-Za-z0-9<>-]*))?/y;

export function parseTracerouteOutput(output: string): TracerouteFinding {
  const normalized = output.replace(/\r\n/g, "\n");
  if (/^%/m.test(normalized)) {
    throw new AppError("diagnostic_command_failed", "EOS could not execute the requested traceroute");
  }
  throwOnDestinationFailure(normalized, "");
  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  const resolvedAddress = parseResolvedAddress(lines[0]);
  const hops = lines.slice(1).map(parseHopLine);
  if (hops.length === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained no hops");
  }
  const lastHop = hops[hops.length - 1];
  const reached = lastHop?.responses.some((response) => response !== null && sameAddress(response.address, resolvedAddress)) === true;
  return { kind: "traceroute", path: reached ? "reached" : "unreached", resolved_address: resolvedAddress, hops };
}

/** `traceroute to <name> (<address>), 30 hops max, 60 byte packets`; only the parenthesized address is used. */
function parseResolvedAddress(headerLine: string | undefined): string {
  const candidate = headerLine === undefined ? undefined : /^traceroute to \S+ \(([^()\s]+)\),/.exec(headerLine)?.[1];
  if (candidate === undefined || isIP(candidate) === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output did not contain a recognized resolved address");
  }
  return candidate;
}

/** A probe with no new responder prints only its RTT, meaning the previous responder answered again. */
function parseHopLine(line: string): TracerouteHop {
  const match = HOP_LINE_PATTERN.exec(line);
  const hopNumber = match === null ? NaN : Number(match[1]);
  const body = match?.[2]?.trimEnd();
  if (body === undefined || !Number.isSafeInteger(hopNumber)) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained an unrecognized line");
  }
  const responses: Array<TracerouteResponse | null> = [];
  let previous: Pick<TracerouteResponse, "address" | "name"> | undefined;
  PROBE_PATTERN.lastIndex = 0;
  let position = 0;
  while (position < body.length) {
    PROBE_PATTERN.lastIndex = position;
    const probe = PROBE_PATTERN.exec(body);
    if (probe === null || probe[0].length === 0) {
      throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained an unrecognized hop line");
    }
    position = PROBE_PATTERN.lastIndex;
    const [, silent, hostLabel, hostAddress, newResponderRtt, repeatRtt, marker] = probe;
    if (silent !== undefined) {
      responses.push(null);
      continue;
    }
    if (hostLabel !== undefined && hostAddress !== undefined) {
      // EOS prints the address itself in place of a name when the reverse lookup finds none.
      previous = { address: hostAddress, ...(hostLabel === hostAddress ? {} : { name: hostLabel }) };
    }
    if (previous === undefined) {
      throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output had a probe time before any responder");
    }
    responses.push({ ...previous, rtt_ms: Number(newResponderRtt ?? repeatRtt), ...(marker === undefined ? {} : { marker }) });
  }
  if (responses.length === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained a hop without probes");
  }
  return { hop: hopNumber, responses };
}

function sameAddress(left: string, right: string): boolean {
  const leftFamily = isIP(left);
  const rightFamily = isIP(right);
  if (leftFamily === 0 || leftFamily !== rightFamily) return false;
  return leftFamily === 6 ? canonicalAddress(left, 6) === canonicalAddress(right, 6) : left === right;
}
