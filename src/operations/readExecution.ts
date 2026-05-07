import { AppError, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { resolveEapiConnection } from "../connection/resolveConnection.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import { resolveInventoryTarget, type ResolvedInventoryTarget } from "../inventory/resolveTarget.js";
import type { InventoryHostModel, InventoryModel } from "../inventory/types.js";

export interface ReadDeviceResultBase {
  inventory_hostname: string;
  resolved_endpoint: string;
  status: "success" | "failed";
  error_code?: string;
  message?: string;
}

export interface DeviceResultSummary {
  total_count: number;
  success_count: number;
  failed_count: number;
}

export interface ExecuteReadOperationResult<TDeviceResult extends ReadDeviceResultBase> {
  resolvedTarget: ResolvedInventoryTarget;
  results: TDeviceResult[];
  summary: DeviceResultSummary;
}

export interface ReadOperationResultEnvelope<TDeviceResult extends ReadDeviceResultBase> {
  target: string;
  target_type: "host" | "group";
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: TDeviceResult[];
}

export async function executeReadOperation<TDeviceResult extends ReadDeviceResultBase>(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: {
    target: string;
    operationName: string;
    responseSizeGuidance?: string;
    validateTarget?: (resolvedTarget: ResolvedInventoryTarget) => void;
    run: (host: InventoryHostModel, connection: EapiConnectionConfig, signal: AbortSignal) => Promise<TDeviceResult>;
    onError: (host: InventoryHostModel, error: unknown) => TDeviceResult;
  }
): Promise<ExecuteReadOperationResult<TDeviceResult>> {
  const resolvedTarget = resolveInventoryTarget(model, {
    target: options.target,
    operationKind: "read"
  });
  enforceReadTargetLimit(config, resolvedTarget.resolvedHosts.length);
  options.validateTarget?.(resolvedTarget);

  const results = await runWithOperationTimeout(
    config,
    options.operationName,
    (signal) =>
      mapWithConcurrency(resolvedTarget.resolvedHosts, config.deviceConcurrency, async (host) => {
        try {
          const connection = resolveEapiConnection(config, host, "read");
          return await options.run(host, connection, signal);
        } catch (error) {
          return options.onError(host, error);
        }
      }, signal)
  );

  enforceResponseSizeLimit(config, results, options.operationName, options.responseSizeGuidance);

  return {
    resolvedTarget,
    results,
    summary: buildDeviceResultSummary(results)
  };
}

export function buildReadOperationResultEnvelope<TDeviceResult extends ReadDeviceResultBase>(
  target: string,
  operation: ExecuteReadOperationResult<TDeviceResult>
): ReadOperationResultEnvelope<TDeviceResult> {
  return {
    target,
    target_type: operation.resolvedTarget.targetType,
    resolved_devices: operation.resolvedTarget.resolvedHosts.map((host) => host.inventoryHostname),
    summary: operation.summary,
    results: operation.results
  };
}

export function buildReadDeviceSuccess<TExtra extends Record<string, unknown>>(
  host: InventoryHostModel,
  extra: TExtra
): ReadDeviceResultBase & { status: "success" } & TExtra {
  return {
    inventory_hostname: host.inventoryHostname,
    resolved_endpoint: host.resolvedEndpoint,
    status: "success",
    ...extra
  };
}

export function buildReadDeviceFailure(
  host: InventoryHostModel,
  errorCode: string,
  error: unknown
): ReadDeviceResultBase & { status: "failed" } {
  return {
    inventory_hostname: host.inventoryHostname,
    resolved_endpoint: host.resolvedEndpoint,
    status: "failed",
    error_code: errorCode,
    message: toErrorMessage(error)
  };
}

export function enforceReadTargetLimit(config: ResolvedServerConfig, targetCount: number): void {
  if (targetCount > config.maxReadTargets) {
    throw new AppError(
      "read_target_limit_exceeded",
      `Read target count ${targetCount} exceeds configured maxReadTargets ${config.maxReadTargets}`
    );
  }
}

export function enforceShowCommandLimit(config: ResolvedServerConfig, commandCount: number): void {
  if (commandCount > config.maxShowCommandsPerRequest) {
    throw new AppError(
      "show_command_limit_exceeded",
      `Show command count ${commandCount} exceeds configured maxShowCommandsPerRequest ${config.maxShowCommandsPerRequest}`
    );
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      throwIfAborted(signal);
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        continue;
      }
      results[currentIndex] = await worker(item);
    }
  }

  const workerCount = Math.min(Math.max(concurrencyLimit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

export async function runWithOperationTimeout<T>(
  config: ResolvedServerConfig,
  operationName: string,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const operation = run(controller.signal);

  if (config.overallOperationTimeoutMs === undefined) {
    return operation;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new AppError(
            "operation_timeout",
            `${operationName} exceeded overallOperationTimeoutMs ${config.overallOperationTimeoutMs}`
          );
          reject(error);
          controller.abort(error);
        }, config.overallOperationTimeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new AppError("operation_timeout", "Operation was aborted");
  }
}

export function enforceResponseSizeLimit(
  config: ResolvedServerConfig,
  results: unknown[],
  operationName: string,
  narrowingGuidance?: string
): void {
  const serialized = JSON.stringify(results);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");

  if (sizeBytes > config.maxResponseSizeBytes) {
    const defaultGuidance = "Reduce the number of target devices or narrow the request scope.";
    throw new AppError(
      "response_size_exceeded",
      `${operationName} response size ${sizeBytes} bytes exceeds configured maxResponseSizeBytes ${config.maxResponseSizeBytes}`,
      {
        responseSizeBytes: sizeBytes,
        maxResponseSizeBytes: config.maxResponseSizeBytes,
        deviceCount: results.length,
        guidance: narrowingGuidance ?? defaultGuidance
      }
    );
  }
}

function buildDeviceResultSummary(results: ReadDeviceResultBase[]): DeviceResultSummary {
  return {
    total_count: results.length,
    success_count: results.filter((result) => result.status === "success").length,
    failed_count: results.filter((result) => result.status === "failed").length
  };
}
