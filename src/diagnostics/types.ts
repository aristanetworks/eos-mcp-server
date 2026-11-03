import type { DiagnosticsConfig } from "../config/diagnostics.js";
import type { AppError } from "../core/errors.js";
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

/** How a dispatched execution ended on the device: it ran to its end with EOS's text output, or EOS's
 * own request timer stopped it (the Device Time Limit). EOS returns no output in that case, but its
 * reply confirms the execution has ended.
 */
export type DiagnosticObservation = { end: "output"; output: string } | { end: "device_time_limit" };

/** Every way one execution can end. A failure says whether EOS may still run the command: `not_dispatched`
 * means the request never left the server, so its slot frees at once; `unknown` means it may have reached
 * EOS, so its slot turns uncertain. `evidence` is EOS's raw text for the failure, exposed only when the
 * caller asks for raw output; `error` never carries it.
 */
export type DiagnosticOutcome =
  | DiagnosticObservation
  | { end: "failed"; error: AppError; remote: "not_dispatched" | "unknown"; evidence?: string };

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

/** Per-kind seam: permission, validation, budgets and admission before dispatch, the execution's eAPI
 * plan and uncertain hold, and interpretation after. The executor runs every prepared execution on every
 * resolved host; device I/O stays in the runner. Nothing outside a definition names its kind's rules.
 */
export interface DiagnosticDefinition<
  TRequest extends DiagnosticRequest = DiagnosticRequest,
  TExecution extends PreparedDiagnostic = PreparedDiagnostic
> {
  /** Every resolved host must have this permission, or the whole request is rejected. */
  permission: { allows(host: InventoryHostModel): boolean; deniedCode: string; deniedMessage: string };
  prepare(request: TRequest, config: DiagnosticsConfig): { request: ResolvedDiagnosticRequest; executions: TExecution[] };
  /** A request is rejected when its executions' total cost, times the resolved host count, exceeds `limit`. */
  budget: { cost(execution: TExecution): number; limit(config: DiagnosticsConfig): number; limitName: string; exceededCode: string };
  /** Bounds the whole call; `settingName` is the setting named when it fires. */
  deadline(config: DiagnosticsConfig): { ms: number; settingName: string };
  /** Of one host's diagnostic slots, at most this many may run this kind at once; absent means only the shared limits apply. */
  perDeviceLimit?(config: DiagnosticsConfig): number;
  eapiExecution(execution: TExecution, config: DiagnosticsConfig): EapiExecutionPlan;
  /** How long a slot stays held once the execution's remote completion is unknown. */
  uncertainHoldMs(execution: TExecution, config: DiagnosticsConfig): number;
  /** Tells a host's results apart: ping's destination; nothing for one execution per host. */
  resultIdentity(execution: TExecution): { destination?: string };
  /** Turns how the execution ended into its finding, or throws an AppError for an execution failure. */
  interpret(observation: DiagnosticObservation, execution: TExecution): DiagnosticFinding;
}

/** `shutdownSignal` aborts only when the server stops. A cancelled call never stops its request, because
 * closing it would not stop the command on EOS, only lose the answer that frees its slot (ADR 0006).
 */
export interface DiagnosticExecutionContext {
  shutdownSignal: AbortSignal;
  requestId: string;
}

/** Device execution seam: inventory identity, typed intent, and the reserved attempt ID. Reports failures as
 * outcomes rather than rejecting; the executor treats a rejection as a failure with unknown remote state.
 */
export interface DiagnosticDeviceRunner {
  execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticOutcome>;
}
