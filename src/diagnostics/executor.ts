import type { ResolvedServerConfig } from "../config/schema.js";
import { AppError, toAppError, toErrorCode } from "../core/errors.js";
import type { InventoryHostModel, InventoryModel } from "../inventory/types.js";
import {
  buildDeviceFailure,
  buildDeviceSuccess,
  runTargetOperation,
  type DeviceResultBase,
  type TargetOperationResult
} from "../operations/targetOperation.js";
import { EapiSlots, type DiagnosticCapacitySnapshot, type DiagnosticReservationIntent } from "../operations/eapiSlots.js";
import { diagnosticDefinitions } from "./definitions.js";
import type {
  DiagnosticDefinition,
  DiagnosticDeviceRunner,
  DiagnosticFinding,
  DiagnosticOutcome,
  DiagnosticRequest,
  PreparedDiagnostic,
  ResolvedDiagnosticRequest
} from "./types.js";

/** Ping entries carry their `destination`; a capture's single execution per host needs no identity. */
export interface DiagnosticDeviceResult extends DeviceResultBase {
  destination?: string;
  finding?: DiagnosticFinding;
  raw_output?: string;
}

export type DiagnosticResult = TargetOperationResult<DiagnosticDeviceResult> & {
  request: ResolvedDiagnosticRequest;
};

/** Owns diagnostic policy, budgets, and each execution's reservation. Target resolution, the deadline,
 * cancellation and the response belong to runTargetOperation, and admission, per device and server-wide,
 * to the EapiSlots it shares with read tools.
 */
export class DiagnosticExecutor {
  private readonly shutdown = new AbortController();

  /** `slots` is required and shared with the read tools; the caller (server wiring) owns it and closes it. */
  constructor(
    private readonly model: InventoryModel,
    private readonly config: ResolvedServerConfig,
    private readonly runner: DiagnosticDeviceRunner,
    private readonly slots: EapiSlots
  ) {}

  close(): void {
    this.shutdown.abort(new AppError("diagnostic_server_stopping", "Diagnostic executor is stopping"));
  }

  getCapacity(): DiagnosticCapacitySnapshot {
    return this.slots.snapshot();
  }

  async execute(options: {
    target: string;
    request: DiagnosticRequest;
    includeRaw?: boolean;
    signal?: AbortSignal;
  }): Promise<DiagnosticResult> {
    const signal = options.signal === undefined ? this.shutdown.signal : AbortSignal.any([options.signal, this.shutdown.signal]);
    const definition = diagnosticDefinitions[options.request.kind];
    const prepared = definition.prepare(options.request, this.config.diagnostics);
    const includeRaw = options.includeRaw === true;

    return runTargetOperation(this.model, this.config, {
      target: options.target,
      operationName: `eos_${options.request.kind}`,
      // Every host starts at once and queues all its executions, so the eAPI slots, not fan-out order,
      // decide which device runs next. Results stay in host-then-execution order.
      concurrency: Infinity,
      deadline: definition.deadline(this.config.diagnostics),
      signal,
      validateTarget: ({ resolvedHosts }) => {
        const denied = resolvedHosts.filter((host) => !definition.permission.allows(host));
        if (denied.length > 0) {
          throw new AppError(definition.permission.deniedCode, `${definition.permission.deniedMessage}: ${denied.map((host) => host.inventoryHostname).join(", ")}`);
        }
        const costPerHost = prepared.executions.reduce((total, execution) => total + definition.budget.cost(execution), 0);
        const budgetLimit = definition.budget.limit(this.config.diagnostics);
        if (resolvedHosts.length * costPerHost > budgetLimit) {
          throw new AppError(definition.budget.exceededCode, `Request exceeds ${definition.budget.limitName} ${budgetLimit}`);
        }
      },
      run: (host, operationSignal) => Promise.all(prepared.executions.map(async (execution) => {
        try {
          return await this.runExecution(definition, host, execution, operationSignal, includeRaw);
        } catch (error) {
          // Failures before dispatch, such as cancellation while queued, have no evidence.
          return buildFailedResult(definition, host, execution, error);
        }
      })),
      failureCode: "diagnostic_execution_failed",
      extra: { request: prepared.request }
    });
  }

  private async runExecution(
    definition: DiagnosticDefinition,
    host: InventoryHostModel,
    execution: PreparedDiagnostic,
    signal: AbortSignal,
    includeRaw: boolean
  ): Promise<DiagnosticDeviceResult> {
    const kindDeviceLimit = definition.perDeviceLimit?.(this.config.diagnostics);
    const outcome = await this.executeOnDevice(host, execution, {
      inventoryHostname: host.inventoryHostname,
      diagnostic: execution.kind,
      uncertainHoldMs: definition.uncertainHoldMs(execution, this.config.diagnostics),
      ...(kindDeviceLimit === undefined ? {} : { kindDeviceLimit })
    }, signal);
    if (outcome.end === "failed") {
      return buildFailedResult(definition, host, execution, outcome.error, includeRaw ? outcome.evidence : undefined);
    }
    // An execution the device timer stopped returns no output, so it has no raw evidence.
    const rawOutput = includeRaw && outcome.end === "output" ? outcome.output : undefined;
    let finding: DiagnosticFinding;
    try {
      finding = definition.interpret(outcome, execution);
    } catch (error) {
      return buildFailedResult(definition, host, execution, error, rawOutput);
    }
    return buildDeviceSuccess(host, {
      ...definition.resultIdentity(execution),
      finding,
      ...(rawOutput === undefined ? {} : { raw_output: rawOutput })
    });
  }

  /** Owns one execution's reservation: dispatch only once admitted, then free it on a confirmed end or hold it
   * as uncertain. A cancelled call turns the slot uncertain at once but leaves the request running, so a
   * late answer still frees the slot before its hold expires (ADR 0006).
   */
  private async executeOnDevice(
    host: InventoryHostModel,
    request: PreparedDiagnostic,
    intent: DiagnosticReservationIntent,
    signal: AbortSignal
  ): Promise<DiagnosticOutcome> {
    const reservation = await this.slots.acquireDiagnostic(signal, intent);
    if (signal.aborted) {
      reservation.complete();
      throw new AppError("operation_aborted", "Diagnostic was cancelled before dispatch");
    }
    const onAbort = (): void => reservation.markUncertain(toErrorCode(signal.reason, "operation_aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    let outcome: DiagnosticOutcome;
    try {
      outcome = await this.runner.execute(host, request, { shutdownSignal: this.shutdown.signal, requestId: reservation.requestId });
    } catch (error) {
      // A runner reports failures as outcomes; anything it throws instead may still have reached EOS.
      outcome = { end: "failed", error: toAppError(error, "diagnostic_execution_failed"), remote: "unknown" };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    switch (outcome.end) {
      case "output":
      case "device_time_limit":
        reservation.complete();
        break;
      case "failed":
        if (outcome.remote === "not_dispatched") reservation.complete();
        else reservation.markUncertain(outcome.error.code);
        break;
    }
    return outcome;
  }
}

/** A failed entry, identified like its execution's success would be, with `rawOutput` only when the caller asked for it. */
function buildFailedResult(
  definition: DiagnosticDefinition,
  host: InventoryHostModel,
  execution: PreparedDiagnostic,
  error: unknown,
  rawOutput?: string
): DiagnosticDeviceResult {
  return {
    ...buildDeviceFailure(host, "diagnostic_execution_failed", error),
    ...definition.resultIdentity(execution),
    ...(rawOutput === undefined ? {} : { raw_output: rawOutput })
  };
}
