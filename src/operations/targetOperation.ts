import { AppError, toErrorCode, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { resolveInventoryTarget, type ResolvedInventoryTarget } from "../inventory/resolveTarget.js";
import type { InventoryHostModel, InventoryModel } from "../inventory/types.js";

/** The fields every per-host entry carries, read or diagnostic. */
export interface DeviceResultBase {
  inventory_hostname: string;
  resolved_endpoint: string;
  status: "success" | "failed";
  error_code?: string;
  message?: string;
}

export type FailedDeviceResult = DeviceResultBase & { status: "failed"; error_code: string; message: string };

export interface DeviceResultSummary {
  total_count: number;
  success_count: number;
  failed_count: number;
}

/** One call's response: its Target, the hosts it resolved to, and every host's entries in host order. */
export interface TargetOperationResult<TEntry extends DeviceResultBase> {
  target: string;
  target_type: "host" | "group";
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: TEntry[];
}

export interface TargetOperationOptions<TEntry extends DeviceResultBase, TExtra extends Record<string, unknown>> {
  target: string;
  /** The MCP tool name, used in timeout and size-limit errors. */
  operationName: string;
  /** Hosts contacted at once; `Infinity` starts every host together and leaves scheduling to the eAPI slots. */
  concurrency: number;
  /** Bounds the whole call once the Target is resolved; absent means no call deadline. The timeout names `settingName`. */
  deadline?: { ms: number; settingName: string };
  signal?: AbortSignal;
  /** Rejects the whole call before any host is contacted, for example a group without a required option. */
  validateTarget?: (resolvedTarget: ResolvedInventoryTarget) => void;
  /** One host's entries, usually one. If it throws, the host gets a single failed entry with `failureCode` as the fallback code. */
  run: (host: InventoryHostModel, signal: AbortSignal) => Promise<TEntry[]>;
  failureCode: string;
  /** Fields merged into the response, such as the echoed request. */
  extra?: TExtra;
  /** Replaces the default advice in a response-size error. */
  narrowingGuidance?: string;
}

/** Runs one operation on every host of a Target and returns the finished response. It enforces
 * `maxReadTargets` before any host is contacted and `maxResponseSizeBytes` on the response, and turns
 * a host's failure into that host's entry, so one host never fails the call. The deadline and the
 * caller's signal abort the work and reject the call with `operation_timeout` or `operation_aborted`.
 */
export async function runTargetOperation<TEntry extends DeviceResultBase, TExtra extends Record<string, unknown> = Record<never, never>>(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: TargetOperationOptions<TEntry, TExtra>
): Promise<TargetOperationResult<TEntry | FailedDeviceResult> & TExtra> {
  const resolvedTarget = resolveInventoryTarget(model, { target: options.target });
  if (resolvedTarget.resolvedHosts.length > config.maxReadTargets) {
    throw new AppError(
      "read_target_limit_exceeded",
      `Read target count ${resolvedTarget.resolvedHosts.length} exceeds configured maxReadTargets ${config.maxReadTargets}`
    );
  }
  options.validateTarget?.(resolvedTarget);

  const entriesByHost = await runWithDeadline(options, (signal) =>
    mapWithConcurrency(resolvedTarget.resolvedHosts, options.concurrency, async (host): Promise<Array<TEntry | FailedDeviceResult>> => {
      try {
        return await options.run(host, signal);
      } catch (error) {
        return [buildDeviceFailure(host, options.failureCode, error)];
      }
    }, signal));
  const results = entriesByHost.flat();

  const response = {
    target: options.target,
    target_type: resolvedTarget.targetType,
    resolved_devices: resolvedTarget.resolvedHosts.map((host) => host.inventoryHostname),
    summary: {
      total_count: results.length,
      success_count: results.filter((result) => result.status === "success").length,
      failed_count: results.filter((result) => result.status === "failed").length
    },
    results,
    ...(options.extra ?? {})
  } as TargetOperationResult<TEntry | FailedDeviceResult> & TExtra;
  enforceResponseSizeLimit(config, response, options.operationName, options.narrowingGuidance);
  return response;
}

/** The concurrency and deadline every read tool uses: `readFanOut` hosts at once, within the top-level `overallOperationTimeoutMs`. */
export function readOperationLimits(config: ResolvedServerConfig): Pick<TargetOperationOptions<DeviceResultBase, Record<never, never>>, "concurrency" | "deadline"> {
  return {
    concurrency: config.readFanOut,
    ...(config.overallOperationTimeoutMs === undefined
      ? {}
      : { deadline: { ms: config.overallOperationTimeoutMs, settingName: "overallOperationTimeoutMs" } })
  };
}

export function buildDeviceSuccess<TExtra extends Record<string, unknown>>(
  host: InventoryHostModel,
  extra: TExtra
): DeviceResultBase & { status: "success" } & TExtra {
  return {
    inventory_hostname: host.inventoryHostname,
    resolved_endpoint: host.resolvedEndpoint,
    status: "success",
    ...extra
  };
}

/** `error`'s own AppError code wins over `fallbackCode`. */
export function buildDeviceFailure(host: InventoryHostModel, fallbackCode: string, error: unknown): FailedDeviceResult {
  return {
    inventory_hostname: host.inventoryHostname,
    resolved_endpoint: host.resolvedEndpoint,
    status: "failed",
    error_code: toErrorCode(error, fallbackCode),
    message: toErrorMessage(error)
  };
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrencyLimit: number,
  worker: (item: TItem) => Promise<TResult>,
  signal: AbortSignal
): Promise<TResult[]> {
  const results: TResult[] = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal.aborted) {
        throw new AppError("operation_timeout", "Operation was aborted");
      }
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];
      if (item === undefined) {
        continue;
      }
      results[currentIndex] = await worker(item);
    }
  }

  // Workers start in item order within one tick, so work that queues on start keeps host order.
  const workerCount = Math.min(Math.max(concurrencyLimit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

/** Races `run` against the deadline and the caller's signal. Work still in flight when either fires is
 * signalled to stop but not awaited, so the call rejects at once.
 */
async function runWithDeadline<TResult>(
  options: { operationName: string; deadline?: { ms: number; settingName: string }; signal?: AbortSignal },
  run: (signal: AbortSignal) => Promise<TResult>
): Promise<TResult> {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const onCancel = (): void => controller.abort(new AppError("operation_aborted", `${options.operationName} was cancelled`));
  callerSignal?.addEventListener("abort", onCancel, { once: true });
  if (callerSignal?.aborted) {
    onCancel();
  }

  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const deadline = options.deadline;
    if (deadline !== undefined) {
      timeout = setTimeout(() => controller.abort(new AppError(
        "operation_timeout",
        `${options.operationName} exceeded ${deadline.settingName} ${deadline.ms}`
      )), deadline.ms);
    }
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) {
        onAbort();
      }
    });
    const operation = controller.signal.aborted ? aborted : run(controller.signal);
    return await Promise.race([operation, aborted]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    callerSignal?.removeEventListener("abort", onCancel);
    if (onAbort !== undefined) {
      controller.signal.removeEventListener("abort", onAbort);
    }
  }
}

function enforceResponseSizeLimit(config: ResolvedServerConfig, payload: unknown, operationName: string, narrowingGuidance?: string): void {
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (sizeBytes > config.maxResponseSizeBytes) {
    throw new AppError(
      "response_size_exceeded",
      `${operationName} response size ${sizeBytes} bytes exceeds configured maxResponseSizeBytes ${config.maxResponseSizeBytes}`,
      {
        responseSizeBytes: sizeBytes,
        maxResponseSizeBytes: config.maxResponseSizeBytes,
        guidance: narrowingGuidance ?? "Reduce the number of target devices or narrow the request scope."
      }
    );
  }
}
