import { z } from "zod";

// Node timers must not overflow into an effectively immediate timeout.
const MAX_TIMER_MS = 2_147_483_647;
const positiveInteger = z.number().int().positive().max(MAX_TIMER_MS);

export const diagnosticsConfigSchema = z.object({
  defaultPingCount: positiveInteger.default(3),
  maxPingCount: positiveInteger.default(10),
  maxProbesPerRequest: positiveInteger.default(100),
  maxDestinationsPerRequest: positiveInteger.default(16),
  deviceConcurrency: positiveInteger.default(5),
  pingReplyTimeoutMs: positiveInteger.multipleOf(1000).default(1000),
  commandTimeoutMs: positiveInteger.default(30_000),
  httpTimeoutMs: positiveInteger.default(35_000),
  overallOperationTimeoutMs: positiveInteger.default(60_000),
  nativeRequestTimeout: z.boolean().default(true)
}).strict("Unrecognized diagnostics setting. diagnostics.stateFile was removed: diagnostic capacity is now held in memory (ADR 0006), so delete it").superRefine((config, context) => {
  const invalid = (path: string, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };
  if (config.defaultPingCount > config.maxPingCount) {
    invalid("defaultPingCount", "Must not exceed maxPingCount");
  }
  if (config.maxPingCount > config.maxProbesPerRequest) {
    invalid("maxPingCount", "Must not exceed maxProbesPerRequest");
  }
  if (pingExecutionBoundMs(config.maxPingCount, config.pingReplyTimeoutMs) > config.commandTimeoutMs) {
    invalid("commandTimeoutMs", "Must cover maxPingCount * (pingReplyTimeoutMs + 1000) + 1000 ms");
  }
  if (config.httpTimeoutMs < config.commandTimeoutMs + 1000) {
    invalid("httpTimeoutMs", "Must exceed commandTimeoutMs by at least 1000 ms");
  }
});

/** Conservative bound: finite probes, fixed 1s spacing, reply waits, and scheduling margin. */
export function pingExecutionBoundMs(count: number, replyTimeoutMs: number): number {
  return count * (1000 + replyTimeoutMs) + 1000;
}

export type DiagnosticsConfig = z.infer<typeof diagnosticsConfigSchema>;
