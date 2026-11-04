import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult } from "../eapi/types.js";
import type { EosDeviceReader } from "../connection/eosDeviceReader.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildLoggingQuery, type LoggingSeverity } from "./loggingQuery.js";
import {
  buildDeviceSuccess,
  readOperationLimits,
  runTargetOperation,
  type DeviceResult,
  type TargetOperationResult
} from "../operations/targetOperation.js";

export interface ShowLoggingOptions {
  target: string;
  minimumSeverity?: LoggingSeverity;
  messageCount?: number;
}

export type ShowLoggingDeviceResult = DeviceResult<{
  command: string;
  log_text: string;
}>;

export type ShowLoggingResult = TargetOperationResult<ShowLoggingDeviceResult> & {
  minimum_severity: LoggingSeverity;
  message_count: number;
};

export async function showLogging(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: ShowLoggingOptions,
  reader: EosDeviceReader,
  signal?: AbortSignal
): Promise<ShowLoggingResult> {
  const query = buildLoggingQuery(
    {
      ...(options.minimumSeverity !== undefined ? { minimumSeverity: options.minimumSeverity } : {}),
      ...(options.messageCount !== undefined ? { messageCount: options.messageCount } : {})
    },
    { maxMessageCount: config.maxLoggingMessagesPerRequest }
  );

  return runTargetOperation(model, config, {
    target: options.target,
    operationName: "eos_show_logging",
    ...readOperationLimits(config),
    ...(signal !== undefined ? { signal } : {}),
    run: async (host, signal): Promise<Array<ShowLoggingResult["results"][number]>> => [
      buildDeviceSuccess(host, {
        command: query.command,
        log_text: extractLogText(await reader.runShowCommands(host, [query.command], "text", { signal }))
      })
    ],
    failureCode: "logging_failed",
    extra: {
      minimum_severity: query.minimumSeverity,
      message_count: query.messageCount
    },
    narrowingGuidance: "Reduce message_count, target fewer devices, or raise minimum_severity to return fewer log lines."
  });
}

function extractLogText(commandResults: EosCommandResult[]): string {
  const first = commandResults[0]?.output;

  if (typeof first === "string") {
    return first;
  }

  throw new AppError("logging_payload_invalid", "Unexpected logging payload structure");
}
