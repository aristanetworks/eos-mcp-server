import { AppError, getErrorCode } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { normalizeShowCommand } from "../eapi/commands.js";
import { extractEapiResults, extractEapiTextOutput, type EapiConnectionConfig, type EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  enforceShowCommandLimit,
  executeReadOperation,
  type DeviceResultSummary
} from "../operations/readExecution.js";

export interface RunShowOptions {
  target: string;
  commands: string[];
  outputFormat: "auto" | "json" | "text";
  includeRaw?: boolean;
}

export interface NormalizedCommandResult {
  command: string;
  output: unknown;
}

export interface RunShowResult {
  target: string;
  target_type: "host" | "group";
  requested_output_format: "auto" | "json" | "text";
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    status: "success" | "failed";
    actual_output_format?: "json" | "text";
    command_results?: NormalizedCommandResult[];
    raw_result?: unknown;
    error_code?: string;
    message?: string;
  }>;
}

export async function runShow(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: RunShowOptions,
  runner: EosCommandRunner
): Promise<RunShowResult> {
  const commands = normalizeShowCommands(options.commands);
  enforceShowCommandLimit(config, commands.length);

  const operation = await executeReadOperation<RunShowResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_run_show",
    responseSizeGuidance: "Reduce the number of target devices, use fewer commands per request, or request text format for more concise output.",
    run: async (host, connection, signal) => {
      const { payload, actualFormat } = await executeShow(runner, connection, commands, options.outputFormat, signal);
      const normalizedResults = normalizeCommandResults(payload, commands, actualFormat);

      return buildReadDeviceSuccess(host, {
        actual_output_format: actualFormat,
        command_results: normalizedResults,
        ...(options.includeRaw ? { raw_result: payload } : {})
      });
    },
    onError: (host, error) => buildReadDeviceFailure(host, mapShowErrorCode(error, options.outputFormat), error)
  });

  return {
    ...buildReadOperationResultEnvelope(options.target, operation),
    requested_output_format: options.outputFormat
  };
}

async function executeShow(
  runner: EosCommandRunner,
  connection: EapiConnectionConfig,
  commands: string[],
  outputFormat: "auto" | "json" | "text",
  signal: AbortSignal
): Promise<{ payload: unknown; actualFormat: "json" | "text" }> {
  const run = async (format: "json" | "text"): Promise<{ payload: unknown; actualFormat: "json" | "text" }> => ({
    payload: await runner.runShowCommands(connection, commands, format, { signal }),
    actualFormat: format
  });

  if (outputFormat === "json") {
    return run("json");
  }

  if (outputFormat === "text") {
    return run("text");
  }

  try {
    return await run("json");
  } catch (error) {
    if (getErrorCode(error) !== "json_output_unavailable") {
      throw error;
    }

    return run("text");
  }
}

function normalizeShowCommands(commands: string[]): string[] {
  if (commands.length === 0) {
    throw new AppError("show_commands_missing", "runShow requires at least one command");
  }

  return commands.map((command) => normalizeShowCommand(command));
}

function normalizeCommandResults(
  payload: unknown,
  commands: string[],
  actualFormat: "json" | "text"
): NormalizedCommandResult[] {
  const eapiResults = extractEapiResults(payload);
  if (eapiResults.length !== commands.length) {
    throw new AppError(
      "eapi_payload_invalid",
      `Unexpected eAPI payload structure: expected ${commands.length} result entries but received ${eapiResults.length}`
    );
  }

  return commands.map((command, index) => {
    const rawEntry = eapiResults[index];
    const output = actualFormat === "text" ? extractTextOutput(rawEntry) : rawEntry;
    return { command, output };
  });
}

function extractTextOutput(entry: unknown): string {
  const textOutput = extractEapiTextOutput(entry);
  if (textOutput !== undefined) {
    return textOutput;
  }
  return typeof entry === "string" ? entry : JSON.stringify(entry);
}

function mapShowErrorCode(error: unknown, outputFormat: "auto" | "json" | "text"): string {
  if (outputFormat === "json" && getErrorCode(error) === "json_output_unavailable") {
    return "json_output_unavailable";
  }

  return "show_command_failed";
}
