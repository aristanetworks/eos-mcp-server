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
/** A command that ran to its end, with EOS's text output. */
export interface DiagnosticOutputObservation {
  kind: DiagnosticRequest["kind"];
  output: string;
}
/** EOS's request timer stopped a capture short of its packet count; EOS returns none of the packets. */
export interface CaptureTimeLimitObservation {
  kind: "packet_capture";
  deviceTimeLimitReached: true;
}
export type DiagnosticObservation = DiagnosticOutputObservation | CaptureTimeLimitObservation;

export interface PingFinding {
  kind: "ping";
  reachability: "reachable" | "partial" | "unreachable";
  packets_sent: number;
  packets_received: number;
  packet_loss_percent: number;
  rtt_ms: { min: number; avg: number; max: number } | null;
}

/** `packets` are tcpdump's lines verbatim, one per packet; protocols are not parsed. An unfilled
 * capture got fewer than `requested_packet_count` packets within the window, not necessarily none,
 * and carries none because the device discards them.
 */
export interface PacketCaptureFinding {
  kind: "packet_capture";
  capture: "complete" | "unfilled";
  requested_packet_count: number;
  window_seconds: number;
  packets: string[];
}

export type DiagnosticFinding = PingFinding | PacketCaptureFinding;

/** The request echoed in results, with server defaults applied. */
export type ResolvedDiagnosticRequest = (PingRequest & { count: number }) | PreparedPacketCapture;

/** How the eAPI runner sends one execution: the EOS command, its HTTP timeout, and EOS's own request timer, if any. */
export interface EapiExecutionPlan {
  command: string;
  httpTimeoutMs: number;
  requestTimeoutSeconds?: number;
}

/** Per-kind seam: permission, validation, and budgets before dispatch, the execution's eAPI plan and
 * uncertain hold, and interpretation after. The executor runs every prepared execution on every
 * resolved host; device I/O stays in the runner.
 */
export interface DiagnosticDefinition<
  TRequest extends DiagnosticRequest = DiagnosticRequest,
  TExecution extends PreparedDiagnostic = PreparedDiagnostic,
  TObservation extends DiagnosticObservation = DiagnosticObservation
> {
  /** Every resolved host must have this permission, or the whole request is rejected. */
  permission: { allows(host: InventoryHostModel): boolean; deniedCode: string; deniedMessage: string };
  prepare(request: TRequest, config: DiagnosticsConfig): { request: ResolvedDiagnosticRequest; executions: TExecution[] };
  /** A request is rejected when its executions' total cost, times the resolved host count, exceeds `limit`. */
  budget: { cost(execution: TExecution): number; limit(config: DiagnosticsConfig): number; limitName: string; exceededCode: string };
  overallOperationTimeoutMs(config: DiagnosticsConfig): number;
  eapiExecution(execution: TExecution, config: DiagnosticsConfig): EapiExecutionPlan;
  /** How long a slot stays held once the execution's remote completion is unknown. */
  uncertainHoldMs(execution: TExecution, config: DiagnosticsConfig): number;
  /** Tells a host's results apart: ping's destination; nothing for one execution per host. */
  resultIdentity(execution: TExecution): { destination?: string };
  /** Receives only observations the runner can produce for this kind. */
  interpret(observation: TObservation, execution: TExecution): DiagnosticFinding;
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
 * capped by the host's shared eAPI headroom and server-wide availability. The `capture_*` counts
 * are the packet captures among the diagnostic slots.
 */
export interface DiagnosticDeviceCapacity extends DiagnosticSlotCounts {
  inventory_hostname: string;
  read_active_count: number;
  read_queued_count: number;
  capture_active_count: number;
  capture_uncertain_count: number;
  capture_queued_count: number;
}

/** Top-level counts are server-wide diagnostics; `devices` breaks them down per host, with reads. */
export interface DiagnosticCapacitySnapshot extends DiagnosticSlotCounts {
  limit: number;
  device_limit: number;
  /** eAPI slots one host may hold across reads and diagnostics. */
  eapi_device_limit: number;
  /** Of a host's diagnostic slots, those packet captures may hold. */
  capture_device_limit: number;
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
