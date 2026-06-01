import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult, EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildLoggingQuery, type LoggingSeverity } from "./loggingQuery.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  executeReadOperation,
  type DeviceResultSummary
} from "../operations/readExecution.js";

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
  const query = buildLoggingQuery(
    {
      ...(options.minimumSeverity !== undefined ? { minimumSeverity: options.minimumSeverity } : {}),
      ...(options.messageCount !== undefined ? { messageCount: options.messageCount } : {})
    },
    { maxMessageCount: config.maxLoggingMessagesPerRequest }
  );

  const operation = await executeReadOperation<ShowLoggingResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_show_logging",
    run: async (host, connection, signal) =>
      buildReadDeviceSuccess(host, {
        command: query.command,
        log_text: extractLogText(await runner.runShowCommands(connection, [query.command], "text", { signal }))
      }),
    onError: (host, error) => buildReadDeviceFailure(host, "logging_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    extra: {
      minimum_severity: query.minimumSeverity,
      message_count: query.messageCount
    },
    responseSizeLimit: {
      config,
      operationName: "eos_show_logging",
      narrowingGuidance: "Reduce message_count, target fewer devices, or raise minimum_severity to return fewer log lines."
    }
  });
}

function extractLogText(commandResults: EosCommandResult[]): string {
  const first = commandResults[0]?.output;

  if (typeof first === "string") {
    return first;
  }

  throw new AppError("logging_payload_invalid", "Unexpected logging payload structure");
}
