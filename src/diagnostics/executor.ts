import type { ResolvedServerConfig } from "../config/schema.js";
import { AppError, toErrorCode } from "../core/errors.js";
import type { InventoryHostModel, InventoryModel } from "../inventory/types.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  executeReadOperation,
  type ReadDeviceResultBase,
  type ReadOperationResultEnvelope
} from "../operations/readExecution.js";
import { DiagnosticConcurrency } from "./concurrency.js";
import { DiagnosticExecutionError } from "./executionError.js";
import type { DiagnosticJournal } from "./journalTypes.js";
import { parsePingOutput, preparePing } from "./ping.js";
import type { DiagnosticCapacitySnapshot, DiagnosticDeviceRunner, DiagnosticFinding, DiagnosticObservation, DiagnosticRequest, PreparedDiagnostic } from "./types.js";

export interface DiagnosticDeviceResult extends ReadDeviceResultBase {
  finding?: DiagnosticFinding;
  raw_output?: string;
}

export type DiagnosticResult = ReadOperationResultEnvelope<DiagnosticDeviceResult> & {
  request: DiagnosticRequest & { count: number };
};

/** Owns policy, budgets, fan-out, global admission, cancellation, and result normalization. */
export class DiagnosticExecutor {
  private readonly concurrency: DiagnosticConcurrency;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly model: InventoryModel,
    private readonly config: ResolvedServerConfig,
    private readonly runner: DiagnosticDeviceRunner,
    journal?: DiagnosticJournal
  ) {
    this.concurrency = new DiagnosticConcurrency(config.diagnostics.deviceConcurrency, journal);
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
    const request = preparePing(options.request, this.config.diagnostics);
    const operationName = `eos_${request.kind}`;
    const operation = await executeReadOperation<DiagnosticDeviceResult>(this.model, {
      ...this.config,
      deviceConcurrency: this.config.diagnostics.deviceConcurrency,
      overallOperationTimeoutMs: this.config.diagnostics.overallOperationTimeoutMs
    }, {
      target: options.target,
      operationName,
      signal,
      validateTarget: (target) => {
        const denied = target.resolvedHosts.filter((host) => !host.diagnosticsAllowed);
        if (denied.length > 0) {
          throw new AppError("diagnostic_policy_denied", `Diagnostic permission denied for: ${denied.map((host) => host.inventoryHostname).join(", ")}`);
        }
        if (target.resolvedHosts.length * request.count > this.config.diagnostics.maxProbesPerRequest) {
          throw new AppError("diagnostic_probe_limit_exceeded", `Request exceeds maxProbesPerRequest ${this.config.diagnostics.maxProbesPerRequest}`);
        }
        this.concurrency.assertUsableCapacity();
      },
      run: async (host, signal) => {
        const observation = await this.executeOnDevice(host, request, signal);
        try {
          const finding = parsePingOutput(observation.output, request.count);
          return buildReadDeviceSuccess(host, {
            finding,
            ...(options.includeRaw === true ? { raw_output: observation.output } : {})
          });
        } catch (error) {
          if (error instanceof AppError && options.includeRaw === true) {
            throw new AppError(error.code, error.message, { raw_output: observation.output });
          }
          throw error;
        }
      },
      onError: (host, error) => ({
        ...buildReadDeviceFailure(host, "diagnostic_execution_failed", error),
        ...(options.includeRaw === true && error instanceof AppError && typeof error.details?.raw_output === "string"
          ? { raw_output: error.details.raw_output }
          : {})
      })
    });
    return buildReadOperationResultEnvelope(options.target, operation, {
      extra: { request: { ...options.request, count: request.count } },
      responseSizeLimit: { config: this.config, operationName }
    });
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
