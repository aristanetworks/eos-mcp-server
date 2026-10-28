import type { InventoryHostModel } from "../inventory/types.js";

// Extend the discriminated request/observation/finding types as diagnostics ship.
// No command-string escape hatch or speculative capture-session contract.
export interface PingRequest {
  kind: "ping";
  destination: string;
  count?: number;
  vrf?: string;
  source?: string;
}

export type DiagnosticRequest = PingRequest;

export interface PreparedPing extends Omit<PingRequest, "count"> {
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

export interface DiagnosticReservationInfo {
  reservation_id: string;
  rpc_request_id?: string;
  inventory_hostname: string;
  diagnostic: DiagnosticRequest["kind"];
  state: "active" | "uncertain";
  reserved_at: string;
  uncertain_since?: string;
  reason_code?: string;
}

export interface DiagnosticCapacitySnapshot {
  scope: "server-instance" | "state-file";
  storage_error_code?: string;
  limit: number;
  available_count: number;
  active_count: number;
  uncertain_count: number;
  queued_count: number;
  reservations: DiagnosticReservationInfo[];
}

export interface DiagnosticExecutionContext {
  signal: AbortSignal;
  requestId: string;
}

/** Device execution seam: inventory identity, typed intent, and a pre-journaled attempt ID.
 * Errors stay uncertain unless classified as not_dispatched/completed by DiagnosticExecutionError.
 */
export interface DiagnosticDeviceRunner {
  execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticObservation>;
}
