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
  mapWithConcurrency,
  runWithOperationTimeout,
  type ReadDeviceResultBase,
  type ReadOperationResultEnvelope
} from "../operations/readExecution.js";
import { DiagnosticConcurrency } from "./concurrency.js";
import { DiagnosticExecutionError } from "./executionError.js";
import { pingDiagnostic } from "./ping.js";
import type {
  DiagnosticCapacitySnapshot,
  DiagnosticDefinition,
  DiagnosticDeviceRunner,
  DiagnosticFinding,
  DiagnosticObservation,
  DiagnosticRequest,
  PreparedDiagnostic,
  ResolvedDiagnosticRequest
} from "./types.js";

export interface DiagnosticDeviceResult extends ReadDeviceResultBase {
  destination: string;
  finding?: DiagnosticFinding;
  raw_output?: string;
}

export type DiagnosticResult = ReadOperationResultEnvelope<DiagnosticDeviceResult> & {
  request: ResolvedDiagnosticRequest;
};

const diagnosticDefinitions: Record<DiagnosticRequest["kind"], DiagnosticDefinition> = {
  ping: pingDiagnostic
};

/** Owns policy, budgets, fan-out, global admission, cancellation, and result normalization. */
export class DiagnosticExecutor {
  private readonly concurrency: DiagnosticConcurrency;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly model: InventoryModel,
    private readonly config: ResolvedServerConfig,
    private readonly runner: DiagnosticDeviceRunner
  ) {
    this.concurrency = new DiagnosticConcurrency(config.diagnostics.deviceConcurrency, config.diagnostics.commandTimeoutMs);
  }

  close(): void {
    this.shutdown.abort(new AppError("diagnostic_server_stopping", "Diagnostic executor is stopping"));
    this.concurrency.close();
  }

  getCapacity(): DiagnosticCapacitySnapshot {
    return this.concurrency.snapshot();
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
      deviceConcurrency: this.config.diagnostics.deviceConcurrency,
      overallOperationTimeoutMs: this.config.diagnostics.overallOperationTimeoutMs
    };

    const resolvedTarget = resolveInventoryTarget(this.model, { target: options.target });
    enforceReadTargetLimit(operationConfig, resolvedTarget.resolvedHosts.length);
    const denied = resolvedTarget.resolvedHosts.filter((host) => !host.diagnosticsAllowed);
    if (denied.length > 0) {
      throw new AppError("diagnostic_policy_denied", `Diagnostic permission denied for: ${denied.map((host) => host.inventoryHostname).join(", ")}`);
    }
    const probesPerHost = prepared.executions.reduce((total, execution) => total + definition.probeCount(execution), 0);
    if (resolvedTarget.resolvedHosts.length * probesPerHost > this.config.diagnostics.maxProbesPerRequest) {
      throw new AppError("diagnostic_probe_limit_exceeded", `Request exceeds maxProbesPerRequest ${this.config.diagnostics.maxProbesPerRequest}`);
    }

    // Each host/execution pair takes its own reservation; results stay in host-then-execution order.
    const hostExecutions = resolvedTarget.resolvedHosts.flatMap((host) => prepared.executions.map((execution) => ({ host, execution })));
    const results = await runWithOperationTimeout(operationConfig, operationName, (operationSignal) =>
      mapWithConcurrency(hostExecutions, operationConfig.deviceConcurrency, async ({ host, execution }) => {
        try {
          return await this.runExecution(definition, host, execution, operationSignal, options.includeRaw === true);
        } catch (error) {
          return {
            ...buildReadDeviceFailure(host, "diagnostic_execution_failed", error),
            destination: execution.destination,
            ...(options.includeRaw === true && error instanceof AppError && typeof error.details?.raw_output === "string"
              ? { raw_output: error.details.raw_output }
              : {})
          };
        }
      }, operationSignal), signal);

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
    const observation = await this.executeOnDevice(host, execution, signal);
    try {
      return buildReadDeviceSuccess(host, {
        destination: execution.destination,
        finding: definition.interpret(observation.output, execution),
        ...(includeRaw ? { raw_output: observation.output } : {})
      });
    } catch (error) {
      if (error instanceof AppError && includeRaw) {
        throw new AppError(error.code, error.message, { raw_output: observation.output });
      }
      throw error;
    }
  }

  private async executeOnDevice(
    host: InventoryHostModel,
    request: PreparedDiagnostic,
    signal: AbortSignal
  ): Promise<DiagnosticObservation> {
    const reservation = await this.concurrency.acquire(signal, { inventoryHostname: host.inventoryHostname, diagnostic: request.kind });
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
