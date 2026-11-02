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

/** Field names follow the tool input, because the resolved request is echoed in results. */
export interface PacketCaptureRequest {
  kind: "packet_capture";
  interface: string;
  vrf?: string;
  filter?: string;
  packet_count?: number;
  window_seconds?: number;
}

export type DiagnosticRequest = PingRequest | PacketCaptureRequest;

/** One ping execution: a single destination with the request's shared options. */
export interface PingExecutionRequest extends Omit<PingRequest, "destinations"> {
  destination: string;
}

export interface PreparedPing extends Omit<PingExecutionRequest, "count"> {
  count: number;
  addressFamily: 4 | 6;
  replyTimeoutSeconds: number;
}

/** A capture is one execution per host, so the prepared execution is the resolved request. */
export interface PreparedPacketCapture extends PacketCaptureRequest {
  packet_count: number;
  window_seconds: number;
}

export type PreparedDiagnostic = PreparedPing | PreparedPacketCapture;
export type DiagnosticObservation = { kind: DiagnosticRequest["kind"]; output: string };

export interface PingFinding {
  kind: "ping";
  reachability: "reachable" | "partial" | "unreachable";
  packets_sent: number;
  packets_received: number;
  packet_loss_percent: number;
  rtt_ms: { min: number; avg: number; max: number } | null;
}

/** `packets` are tcpdump's lines verbatim, one per packet; protocols are not parsed. */
export interface PacketCaptureFinding {
  kind: "packet_capture";
  capture: "complete";
  requested_packet_count: number;
  window_seconds: number;
  packets: string[];
}

export type DiagnosticFinding = PingFinding | PacketCaptureFinding;

/** The request echoed in results, with server defaults applied. */
export type ResolvedDiagnosticRequest = (PingRequest & { count: number }) | PreparedPacketCapture;

/** Per-kind seam: permission, validation, and budgets before dispatch, the per-execution
 * uncertain hold, and interpretation after. The executor runs every prepared execution on every
 * resolved host; device I/O stays in the runner.
 */
export interface DiagnosticDefinition<TRequest extends DiagnosticRequest = DiagnosticRequest, TExecution extends PreparedDiagnostic = PreparedDiagnostic> {
  /** Every resolved host must have this permission, or the whole request is rejected. */
  permission: { allows(host: InventoryHostModel): boolean; deniedCode: string; deniedMessage: string };
  prepare(request: TRequest, config: DiagnosticsConfig): { request: ResolvedDiagnosticRequest; executions: TExecution[] };
  /** Rejects a request whose executions, run on `hostCount` hosts, exceed the kind's aggregate budget. */
  enforceBudget(hostCount: number, executions: TExecution[], config: DiagnosticsConfig): void;
  overallOperationTimeoutMs(config: DiagnosticsConfig): number;
  /** How long a slot stays held once the execution's remote completion is unknown. */
  uncertainHoldMs(execution: TExecution, config: DiagnosticsConfig): number;
  /** Fields that tell a host's results apart, such as ping's destination; empty for one execution per host. */
  resultIdentity(execution: TExecution): Record<string, string>;
  interpret(output: string, execution: TExecution): DiagnosticFinding;
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
