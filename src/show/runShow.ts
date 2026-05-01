import { AppError, getErrorCode, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, enforceShowCommandLimit, executeReadOperation } from "../operations/readExecution.js";

export interface ShowRunner {
  runShowCommands(connection: EapiConnectionConfig, commands: string[], format: "json" | "text"): Promise<unknown>;
}

export interface RunShowOptions {
  target: string;
  commands: string[];
  outputFormat: "auto" | "json" | "text";
}

export interface RunShowResult {
  target: string;
  target_type: "host" | "group";
  requested_output_format: "auto" | "json" | "text";
  resolved_devices: string[];
  summary: {
    total_count: number;
    success_count: number;
    failed_count: number;
  };
  results: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    status: "success" | "failed";
    actual_output_format?: "json" | "text";
    command_results?: unknown;
    error_code?: string;
    message?: string;
  }>;
}

export async function runShow(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: RunShowOptions,
  runner: ShowRunner
): Promise<RunShowResult> {
  validateShowCommands(options.commands);
  enforceShowCommandLimit(config, options.commands.length);

  const operation = await executeReadOperation<RunShowResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_run_show",
    run: async (host, connection) => {
      const { payload, actualFormat } = await executeShow(runner, connection, options.commands, options.outputFormat);

      return {
        inventory_hostname: host.inventoryHostname,
        resolved_endpoint: host.resolvedEndpoint,
        status: "success",
        actual_output_format: actualFormat,
        command_results: payload
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
  runner: ShowRunner,
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

function mapShowErrorCode(error: unknown, outputFormat: "auto" | "json" | "text"): string {
  if (outputFormat === "json" && getErrorCode(error) === "json_output_unavailable") {
    return "json_output_unavailable";
  }

  return "show_command_failed";
}
