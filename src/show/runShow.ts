import { AppError, getErrorCode, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { extractEapiResults, extractEapiTextOutput, type EapiConnectionConfig, type EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, enforceShowCommandLimit, executeReadOperation, type DeviceResultSummary } from "../operations/readExecution.js";

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
  validateShowCommands(options.commands);
  enforceShowCommandLimit(config, options.commands.length);

  const operation = await executeReadOperation<RunShowResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_run_show",
    responseSizeGuidance: "Reduce the number of target devices, use fewer commands per request, or request text format for more concise output.",
    run: async (host, connection) => {
      const { payload, actualFormat } = await executeShow(runner, connection, options.commands, options.outputFormat);
      const normalizedResults = normalizeCommandResults(payload, options.commands, actualFormat);

      return {
        inventory_hostname: host.inventoryHostname,
        resolved_endpoint: host.resolvedEndpoint,
        status: "success",
        actual_output_format: actualFormat,
        command_results: normalizedResults,
        ...(options.includeRaw ? { raw_result: payload } : {})
      };
    },
    onError: (host, error) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "failed",
      error_code: mapShowErrorCode(error, options.outputFormat),
      message: toErrorMessage(error)
    })
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
  outputFormat: "auto" | "json" | "text"
): Promise<{ payload: unknown; actualFormat: "json" | "text" }> {
  if (outputFormat === "json") {
    return {
      payload: await runner.runShowCommands(connection, commands, "json"),
      actualFormat: "json"
    };
  }

  if (outputFormat === "text") {
    return {
      payload: await runner.runShowCommands(connection, commands, "text"),
      actualFormat: "text"
    };
  }

  try {
    return {
      payload: await runner.runShowCommands(connection, commands, "json"),
      actualFormat: "json"
    };
  } catch (error) {
    if (getErrorCode(error) !== "json_output_unavailable") {
      throw error;
    }

    return {
      payload: await runner.runShowCommands(connection, commands, "text"),
      actualFormat: "text"
    };
  }
}

function validateShowCommands(commands: string[]): void {
  if (commands.length === 0) {
    throw new AppError("show_commands_missing", "runShow requires at least one command");
  }

  for (const command of commands) {
    const normalized = command.trim();
    if (!normalized.toLowerCase().startsWith("show ") && normalized.toLowerCase() !== "show") {
      throw new AppError("show_command_invalid", `Only show commands are allowed in eos_run_show: ${command}`);
    }
  }
}

function normalizeCommandResults(
  payload: unknown,
  commands: string[],
  actualFormat: "json" | "text"
): NormalizedCommandResult[] {
  const eapiResults = extractEapiResults(payload);

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
