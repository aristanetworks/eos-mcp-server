import { isIP } from "node:net";
import { tracerouteHttpTimeoutMs } from "../config/diagnostics.js";
import { AppError } from "../core/errors.js";
import { canonicalAddress, prepareDestination, prepareDestinations, throwOnDestinationFailure } from "./destination.js";
import type { PreparedDestination } from "./destination.js";
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
    // Every destination is validated, and duplicates rejected, before any is dispatched.
    const executions = prepareDestinations(destinations, shared).map((prepared) => buildPreparedTraceroute(shared, prepared));
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
    // EOS runs traceroute unprivileged, so a role without enable can still trace (measured on cEOS 4.34.3M).
    enable: false,
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
  const { destination, ...shared } = request;
  return buildPreparedTraceroute(shared, prepareDestination(destination, shared));
}

function buildPreparedTraceroute(shared: Omit<TracerouteExecutionRequest, "destination">, prepared: PreparedDestination): PreparedTraceroute {
  if (shared.vrf !== undefined) validateVrf(shared.vrf);
  return { ...shared, destination: prepared.destination, addressFamily: prepared.addressFamily };
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
const HEADER_PATTERN = /^traceroute to \S+ \(([^()\s]+)\), (\d{1,3}) hops max,/;
// EOS sends three probes per hop and offers no option to change it (ADR 0013).
const PROBES_PER_HOP = 3;
const HOP_LINE_PATTERN = /^\s*(\d{1,3})\s+(\S.*)$/;
const PROBE_PATTERN = /\s*(?:(\*)|(\S+) \(([^()\s]+)\)\s+(\d+(?:\.\d+)?) ms|(\d+(?:\.\d+)?) ms)(?:\s+(![A-Za-z0-9<>-]*))?/y;

export function parseTracerouteOutput(output: string): TracerouteFinding {
  const normalized = output.replace(/\r\n/g, "\n");
  if (/^%/m.test(normalized)) {
    throw new AppError("diagnostic_command_failed", "EOS could not execute the requested traceroute");
  }
  throwOnDestinationFailure(normalized, "");
  const lines = normalized.split("\n").filter((line) => line.trim() !== "");
  const { resolvedAddress, maxHops } = parseHeader(lines[0]);
  const hops = lines.slice(1).map(parseHopLine);
  if (hops.length === 0) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained no hops");
  }
  // The path is judged by the last hop, so hops out of order or past the header's limit must never be classified.
  if (hops.length > maxHops || hops.some((hop, index) => hop.hop !== index + 1)) {
    throw new AppError("diagnostic_output_unrecognized", `EOS traceroute output did not number its hops 1, 2, 3, ... up to at most ${maxHops}`);
  }
  const lastHop = hops[hops.length - 1];
  const reached = lastHop?.responses.some((response) => response !== null && sameAddress(response.address, resolvedAddress)) === true;
  return { kind: "traceroute", path: reached ? "reached" : "unreached", resolved_address: resolvedAddress, hops };
}

/** `traceroute to <name> (<address>), 30 hops max, 60 byte packets`: the parenthesized address and the hop limit. */
function parseHeader(headerLine: string | undefined): { resolvedAddress: string; maxHops: number } {
  const header = headerLine === undefined ? null : HEADER_PATTERN.exec(headerLine);
  const resolvedAddress = header?.[1];
  const maxHops = Number(header?.[2]);
  if (resolvedAddress === undefined || addressComparisonKey(resolvedAddress) === undefined || !(maxHops >= 1)) {
    throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output did not contain a recognized header");
  }
  return { resolvedAddress, maxHops };
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
      // An invalid responder address must never become an unreached finding.
      if (addressComparisonKey(hostAddress) === undefined) {
        throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained a responder address that is not a valid IP address");
      }
      // EOS prints the address itself in place of a name when the reverse lookup finds none.
      previous = { address: hostAddress, ...(hostLabel === hostAddress ? {} : { name: hostLabel }) };
    }
    if (previous === undefined) {
      throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output had a probe time before any responder");
    }
    const rttMs = Number(newResponderRtt ?? repeatRtt);
    // A digit run too long for a double becomes Infinity, which JSON would carry as null.
    if (!Number.isFinite(rttMs)) {
      throw new AppError("diagnostic_output_unrecognized", "EOS traceroute output contained an unrecognized probe time");
    }
    responses.push({ ...previous, rtt_ms: rttMs, ...(marker === undefined ? {} : { marker }) });
  }
  if (responses.length === 0 || responses.length > PROBES_PER_HOP) {
    throw new AppError("diagnostic_output_unrecognized", `EOS traceroute output contained a hop without 1 to ${PROBES_PER_HOP} probes`);
  }
  return { hop: hopNumber, responses };
}

/** Both addresses were validated while parsing, so an undefined key cannot match. */
function sameAddress(left: string, right: string): boolean {
  const leftKey = addressComparisonKey(left);
  return leftKey !== undefined && leftKey === addressComparisonKey(right);
}

// An IPv6 scope (zone) identifier as Linux prints it: an interface name or index.
const ZONE_PATTERN = /^[A-Za-z0-9_.:/-]+$/;

/** A printed address's identity, or undefined when it is not a valid IP address. IPv6 is compared canonically
 * and keeps its scope (`fe80::1%Ethernet1`), since the same link-local address on two links is two addresses.
 * A scope is only valid on IPv6; the URL-based canonicalization rejects scopes, so it is split off first.
 */
function addressComparisonKey(printedAddress: string): string | undefined {
  const scopeStart = printedAddress.indexOf("%");
  const address = scopeStart === -1 ? printedAddress : printedAddress.slice(0, scopeStart);
  const zone = scopeStart === -1 ? undefined : printedAddress.slice(scopeStart + 1);
  const family = isIP(address);
  if (family === 0 || (zone !== undefined && (family !== 6 || !ZONE_PATTERN.test(zone)))) return undefined;
  return family === 6 ? `${canonicalAddress(address, 6)}${zone === undefined ? "" : `%${zone}`}` : address;
}
