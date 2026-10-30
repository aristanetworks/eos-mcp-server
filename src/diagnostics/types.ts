import type { DiagnosticsConfig } from "../config/diagnostics.js";
import type { InventoryHostModel } from "../inventory/types.js";

// Extend the discriminated request/observation/finding types as diagnostics ship.
// No command-string escape hatch or speculative capture-session contract.
export interface PingRequest {
  kind: "ping";
  destinations: string[];
  count?: number;
  vrf?: string;
  source?: string;
}

export type DiagnosticRequest = PingRequest;

/** One ping execution: a single destination with the request's shared options. */
export interface PingExecutionRequest extends Omit<PingRequest, "destinations"> {
  destination: string;
}

export interface PreparedPing extends Omit<PingExecutionRequest, "count"> {
  count: number;
  addressFamily: 4 | 6;
  replyTimeoutSeconds: number;
}

export type PreparedDiagnostic = PreparedPing;
export type DiagnosticObservation = { kind: "ping"; output: string };

export interface PingFinding {
  kind: "ping";
  reachability: "reachable" | "partial" | "unreachable";
  packets_sent: number;
  packets_received: number;
  packet_loss_percent: number;
  rtt_ms: { min: number; avg: number; max: number } | null;
}

export type DiagnosticFinding = PingFinding;

/** The request echoed in results, with server defaults applied. */
export type ResolvedDiagnosticRequest = DiagnosticRequest & { count: number };

/** Per-kind seam: validation and probe cost before dispatch, interpretation after.
 * The executor runs every prepared execution on every resolved host; device I/O stays in the runner.
 */
export interface DiagnosticDefinition {
  prepare(request: DiagnosticRequest, config: DiagnosticsConfig): { request: ResolvedDiagnosticRequest; executions: PreparedDiagnostic[] };
  probeCount(execution: PreparedDiagnostic): number;
  interpret(output: string, execution: PreparedDiagnostic): DiagnosticFinding;
}

/** `reservation_id` doubles as the execution's JSON-RPC request ID. */
export interface DiagnosticReservationInfo {
  reservation_id: string;
  inventory_hostname: string;
  diagnostic: DiagnosticRequest["kind"];
  state: "active" | "uncertain";
  reserved_at: string;
  uncertain_since?: string;
  releases_at?: string;
  reason_code?: string;
}

interface DiagnosticSlotCounts {
  available_count: number;
  active_count: number;
  uncertain_count: number;
  queued_count: number;
}

/** Slot usage of one inventory host; only hosts holding or awaiting a slot are listed.
 * The four shared counts are diagnostic slots; `available_count` is the diagnostic headroom,
 * capped by the host's shared eAPI headroom and server-wide availability.
 */
export interface DiagnosticDeviceCapacity extends DiagnosticSlotCounts {
  inventory_hostname: string;
  read_active_count: number;
  read_queued_count: number;
}

/** Top-level counts are server-wide diagnostics; `devices` breaks them down per host, with reads. */
export interface DiagnosticCapacitySnapshot extends DiagnosticSlotCounts {
  limit: number;
  device_limit: number;
  /** eAPI slots one host may hold across reads and diagnostics. */
  eapi_device_limit: number;
  devices: DiagnosticDeviceCapacity[];
  reservations: DiagnosticReservationInfo[];
}

export interface DiagnosticExecutionContext {
  signal: AbortSignal;
  requestId: string;
}

/** Device execution seam: inventory identity, typed intent, and the reserved attempt ID.
 * Errors stay uncertain unless classified as not_dispatched/completed by DiagnosticExecutionError.
 */
export interface DiagnosticDeviceRunner {
  execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticObservation>;
}
