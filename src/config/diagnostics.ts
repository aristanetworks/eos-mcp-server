import { z } from "zod";

// Node timers must not overflow into an effectively immediate timeout.
const MAX_TIMER_MS = 2_147_483_647;
// EOS accepts tcpdump packet-count values from 1 to 10000.
const EOS_MAX_CAPTURE_PACKET_COUNT = 10_000;
const positiveInteger = z.number().int().positive().max(MAX_TIMER_MS);

export const diagnosticsConfigSchema = z.object({
  stateFile: z.never({ message: "Removed: diagnostic capacity is now held in memory (ADR 0006); delete this setting" }).optional(),
  defaultPingCount: positiveInteger.default(3),
  maxPingCount: positiveInteger.default(10),
  maxProbesPerRequest: positiveInteger.default(100),
  maxDestinationsPerRequest: positiveInteger.default(16),
  deviceConcurrency: positiveInteger.default(2),
  maxConcurrentDiagnostics: positiveInteger.default(32),
  pingReplyTimeoutMs: positiveInteger.multipleOf(1000).default(1000),
  commandTimeoutMs: positiveInteger.default(30_000),
  httpTimeoutMs: positiveInteger.default(35_000),
  overallOperationTimeoutMs: positiveInteger.default(60_000),
  nativeRequestTimeout: z.boolean().default(true),
  defaultCapturePacketCount: positiveInteger.default(10),
  maxCapturePacketCount: positiveInteger.max(EOS_MAX_CAPTURE_PACKET_COUNT).default(1000),
  defaultCaptureWindowSeconds: positiveInteger.default(10),
  maxCaptureWindowSeconds: positiveInteger.default(60),
  maxCapturePacketsPerRequest: positiveInteger.default(2000),
  captureOverallOperationTimeoutMs: positiveInteger.default(90_000)
}).strict().superRefine((config, context) => {
  const invalid = (path: string, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };
  if (config.defaultPingCount > config.maxPingCount) {
    invalid("defaultPingCount", "Must not exceed maxPingCount");
  }
  if (config.maxPingCount > config.maxProbesPerRequest) {
    invalid("maxPingCount", "Must not exceed maxProbesPerRequest");
  }
  if (config.deviceConcurrency > config.maxConcurrentDiagnostics) {
    invalid("deviceConcurrency", "Must not exceed maxConcurrentDiagnostics");
  }
  if (pingExecutionBoundMs(config.maxPingCount, config.pingReplyTimeoutMs) > config.commandTimeoutMs) {
    invalid("commandTimeoutMs", "Must cover maxPingCount * (pingReplyTimeoutMs + 1000) + 1000 ms");
  }
  if (config.httpTimeoutMs < config.commandTimeoutMs + 1000) {
    invalid("httpTimeoutMs", "Must exceed commandTimeoutMs by at least 1000 ms");
  }
  if (config.defaultCapturePacketCount > config.maxCapturePacketCount) {
    invalid("defaultCapturePacketCount", "Must not exceed maxCapturePacketCount");
  }
  if (config.maxCapturePacketCount > config.maxCapturePacketsPerRequest) {
    invalid("maxCapturePacketCount", "Must not exceed maxCapturePacketsPerRequest");
  }
  if (config.defaultCaptureWindowSeconds > config.maxCaptureWindowSeconds) {
    invalid("defaultCaptureWindowSeconds", "Must not exceed maxCaptureWindowSeconds");
  }
  if (config.captureOverallOperationTimeoutMs <= config.maxCaptureWindowSeconds * 1000) {
    invalid("captureOverallOperationTimeoutMs", "Must exceed maxCaptureWindowSeconds");
  }
});

/** Conservative bound: finite probes, fixed 1s spacing, reply waits, and scheduling margin. */
export function pingExecutionBoundMs(count: number, replyTimeoutMs: number): number {
  return count * (1000 + replyTimeoutMs) + 1000;
}

export type DiagnosticsConfig = z.infer<typeof diagnosticsConfigSchema>;
