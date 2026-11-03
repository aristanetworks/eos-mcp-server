import type { ResolvedServerConfig } from "../config/schema.js";
import { AppError, toErrorCode } from "../core/errors.js";
import { resolveInventoryTarget } from "../inventory/resolveTarget.js";
import type { InventoryHostModel, InventoryModel } from "../inventory/types.js";
import {
  buildDeviceResultSummary,
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  enforceReadTargetLimit,
  runWithOperationTimeout,
  type ReadDeviceResultBase,
  type ReadOperationResultEnvelope
} from "../operations/readExecution.js";
import { EapiSlots, eapiSlotLimits, type DiagnosticCapacitySnapshot, type DiagnosticReservationIntent } from "../operations/eapiSlots.js";
import { DiagnosticExecutionError } from "./executionError.js";
import { diagnosticDefinitions } from "./definitions.js";
import type {
  DiagnosticDefinition,
  DiagnosticDeviceRunner,
  DiagnosticFinding,
  DiagnosticObservation,
  DiagnosticRequest,
  PreparedDiagnostic,
  ResolvedDiagnosticRequest
} from "./types.js";

/** Ping entries carry their `destination`; a capture's single execution per host needs no identity. */
export interface DiagnosticDeviceResult extends ReadDeviceResultBase {
  destination?: string;
  finding?: DiagnosticFinding;
  raw_output?: string;
}

export type DiagnosticResult = ReadOperationResultEnvelope<DiagnosticDeviceResult> & {
  request: ResolvedDiagnosticRequest;
};

/** Owns policy, budgets, fan-out, cancellation, and result normalization. Admission, per device and
 * server-wide, belongs to the EapiSlots it shares with read tools.
 */
export class DiagnosticExecutor {
  private readonly shutdown = new AbortController();

  /** A running server passes its shared `slots`; tests may omit it to get a private instance. */
  constructor(
    private readonly model: InventoryModel,
    private readonly config: ResolvedServerConfig,
    private readonly runner: DiagnosticDeviceRunner,
    private readonly slots = new EapiSlots(eapiSlotLimits(config))
  ) {}

  close(): void {
    this.shutdown.abort(new AppError("diagnostic_server_stopping", "Diagnostic executor is stopping"));
    this.slots.close();
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
    const operationName = `eos_${options.request.kind}`;
    const operationConfig: ResolvedServerConfig = {
      ...this.config,
      overallOperationTimeoutMs: definition.overallOperationTimeoutMs(this.config.diagnostics)
    };

    const resolvedTarget = resolveInventoryTarget(this.model, { target: options.target });
    enforceReadTargetLimit(operationConfig, resolvedTarget.resolvedHosts.length);
    const denied = resolvedTarget.resolvedHosts.filter((host) => !definition.permission.allows(host));
    if (denied.length > 0) {
      throw new AppError(definition.permission.deniedCode, `${definition.permission.deniedMessage}: ${denied.map((host) => host.inventoryHostname).join(", ")}`);
    }
    const costPerHost = prepared.executions.reduce((total, execution) => total + definition.budget.cost(execution), 0);
    const budgetLimit = definition.budget.limit(this.config.diagnostics);
    if (resolvedTarget.resolvedHosts.length * costPerHost > budgetLimit) {
      throw new AppError(definition.budget.exceededCode, `Request exceeds ${definition.budget.limitName} ${budgetLimit}`);
    }

    // Each host/execution pair takes its own reservation, and all are queued at once so the admission
    // controller, not fan-out order, decides which device runs next. Results stay in host-then-execution order.
    const hostExecutions = resolvedTarget.resolvedHosts.flatMap((host) => prepared.executions.map((execution) => ({ host, execution })));
    const results = await runWithOperationTimeout(operationConfig, operationName, (operationSignal) =>
      Promise.all(hostExecutions.map(async ({ host, execution }) => {
        try {
          return await this.runExecution(definition, host, execution, operationSignal, options.includeRaw === true);
        } catch (error) {
          return {
            ...buildReadDeviceFailure(host, "diagnostic_execution_failed", error),
            ...definition.resultIdentity(execution),
            ...(options.includeRaw === true && error instanceof AppError && typeof error.details?.raw_output === "string"
              ? { raw_output: error.details.raw_output }
              : {})
          };
        }
      })), signal);

    return buildReadOperationResultEnvelope(options.target, { resolvedTarget, results, summary: buildDeviceResultSummary(results) }, {
      extra: { request: prepared.request },
      responseSizeLimit: { config: this.config, operationName }
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
    const observation = await this.executeOnDevice(host, execution, {
      inventoryHostname: host.inventoryHostname,
      diagnostic: execution.kind,
      uncertainHoldMs: definition.uncertainHoldMs(execution, this.config.diagnostics),
      ...(kindDeviceLimit === undefined ? {} : { kindDeviceLimit })
    }, signal);
    // An execution the device timer stopped returns no output, so it has no raw evidence.
    const rawOutput = observation.end === "output" ? observation.output : undefined;
    try {
      return buildReadDeviceSuccess(host, {
        ...definition.resultIdentity(execution),
        finding: definition.interpret(observation, execution),
        ...(includeRaw && rawOutput !== undefined ? { raw_output: rawOutput } : {})
      });
    } catch (error) {
      if (error instanceof AppError && includeRaw && rawOutput !== undefined) {
        throw new AppError(error.code, error.message, { raw_output: rawOutput });
      }
      throw error;
    }
  }

  private async executeOnDevice(
    host: InventoryHostModel,
    request: PreparedDiagnostic,
    intent: DiagnosticReservationIntent,
    signal: AbortSignal
  ): Promise<DiagnosticObservation> {
    const reservation = await this.slots.acquireDiagnostic(signal, intent);
    if (signal.aborted) {
      reservation.complete();
      throw new AppError("operation_aborted", "Diagnostic was cancelled before dispatch");
    }
    const onAbort = (): void => reservation.markUncertain(toErrorCode(signal.reason, "operation_aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const observation = await this.runner.execute(host, request, { signal, requestId: reservation.requestId });
      reservation.complete();
      return observation;
    } catch (error) {
      if (error instanceof DiagnosticExecutionError && (error.executionState === "not_dispatched" || error.executionState === "completed")) {
        reservation.complete();
      } else {
        reservation.markUncertain(toErrorCode(error, "diagnostic_execution_failed"));
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
