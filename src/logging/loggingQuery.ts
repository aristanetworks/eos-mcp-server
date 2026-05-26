import { AppError } from "../core/errors.js";

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

export interface BuildLoggingQueryOptions {
  minimumSeverity?: string;
  messageCount?: number;
}

export interface BuildLoggingQueryLimits {
  maxMessageCount: number;
}

export interface LoggingQuery {
  minimumSeverity: LoggingSeverity;
  messageCount: number;
  command: string;
}

export function buildLoggingQuery(options: BuildLoggingQueryOptions, limits: BuildLoggingQueryLimits): LoggingQuery {
  const minimumSeverity = normalizeLoggingSeverity(options.minimumSeverity ?? "warnings");
  const messageCount = normalizeMessageCount(limits.maxMessageCount, options.messageCount ?? DEFAULT_LOGGING_MESSAGE_COUNT);

  return {
    minimumSeverity,
    messageCount,
    command: `show logging threshold ${minimumSeverity} ${messageCount}`
  };
}

function normalizeLoggingSeverity(severity: string): LoggingSeverity {
  if ((LOGGING_SEVERITIES as readonly string[]).includes(severity)) {
    return severity as LoggingSeverity;
  }

  throw new AppError("logging_severity_invalid", `Unsupported logging severity: ${severity}`);
}

function normalizeMessageCount(maxMessageCount: number, messageCount: number): number {
  if (!Number.isInteger(messageCount) || messageCount < 1 || messageCount > EOS_MAX_LOGGING_MESSAGE_COUNT) {
    throw new AppError(
      "logging_message_count_invalid",
      `Logging message_count must be an integer from 1 to ${EOS_MAX_LOGGING_MESSAGE_COUNT}`
    );
  }

  if (messageCount > maxMessageCount) {
    throw new AppError(
      "logging_message_count_limit_exceeded",
      `Logging message_count ${messageCount} exceeds configured maxLoggingMessagesPerRequest ${maxMessageCount}`
    );
  }

  return messageCount;
}
