import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { extractEapiTextOutput, parseEapiRunCmdsResponse, type EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  executeReadOperation,
  type DeviceResultSummary
} from "../operations/readExecution.js";

export const LOGGING_SEVERITIES = [
  "emergencies",
  "alerts",
  "critical",
  "errors",
  "warnings",
  "notifications",
  "informational",
  "debugging"
] as const;

export type LoggingSeverity = (typeof LOGGING_SEVERITIES)[number];

const DEFAULT_LOGGING_MESSAGE_COUNT = 100;
const EOS_MAX_LOGGING_MESSAGE_COUNT = 9999;

export interface ShowLoggingOptions {
  target: string;
  minimumSeverity?: LoggingSeverity;
  messageCount?: number;
}

export interface ShowLoggingResult {
  target: string;
  target_type: "host" | "group";
  minimum_severity: LoggingSeverity;
  message_count: number;
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    status: "success" | "failed";
    command?: string;
    log_text?: string;
    error_code?: string;
    message?: string;
  }>;
}

export async function showLogging(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: ShowLoggingOptions,
  runner: EosCommandRunner
): Promise<ShowLoggingResult> {
  const minimumSeverity = normalizeLoggingSeverity(options.minimumSeverity ?? "warnings");
  const messageCount = normalizeMessageCount(config, options.messageCount ?? DEFAULT_LOGGING_MESSAGE_COUNT);
  const command = `show logging threshold ${minimumSeverity} ${messageCount}`;

  const operation = await executeReadOperation<ShowLoggingResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_show_logging",
    run: async (host, connection, signal) =>
      buildReadDeviceSuccess(host, {
        command,
        log_text: extractLogText(await runner.runShowCommands(connection, [command], "text", { signal }))
      }),
    onError: (host, error) => buildReadDeviceFailure(host, "logging_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    extra: {
      minimum_severity: minimumSeverity,
      message_count: messageCount
    },
    responseSizeLimit: {
      config,
      operationName: "eos_show_logging",
      narrowingGuidance: "Reduce message_count, target fewer devices, or raise minimum_severity to return fewer log lines."
    }
  });
}

function normalizeLoggingSeverity(severity: string): LoggingSeverity {
  if ((LOGGING_SEVERITIES as readonly string[]).includes(severity)) {
    return severity as LoggingSeverity;
  }

  throw new AppError("logging_severity_invalid", `Unsupported logging severity: ${severity}`);
}

function normalizeMessageCount(config: ResolvedServerConfig, messageCount: number): number {
  if (!Number.isInteger(messageCount) || messageCount < 1 || messageCount > EOS_MAX_LOGGING_MESSAGE_COUNT) {
    throw new AppError(
      "logging_message_count_invalid",
      `Logging message_count must be an integer from 1 to ${EOS_MAX_LOGGING_MESSAGE_COUNT}`
    );
  }

  if (messageCount > config.maxLoggingMessagesPerRequest) {
    throw new AppError(
      "logging_message_count_limit_exceeded",
      `Logging message_count ${messageCount} exceeds configured maxLoggingMessagesPerRequest ${config.maxLoggingMessagesPerRequest}`
    );
  }

  return messageCount;
}

function extractLogText(rawResult: unknown): string {
  const results = parseEapiRunCmdsResponse(rawResult, 1).result;
  const first = results[0];

  if (typeof first === "string") {
    return first;
  }

  const textOutput = extractEapiTextOutput(first);
  if (textOutput !== undefined) {
    return textOutput;
  }

  throw new AppError("logging_payload_invalid", "Unexpected logging payload structure");
}
