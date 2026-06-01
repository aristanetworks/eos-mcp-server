import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { normalizeShowCommand } from "../eapi/commands.js";
import type { EosCommandResult, EosCommandRunner } from "../eapi/types.js";
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

export type NormalizedCommandResult = EosCommandResult;

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
    run: async (host, connection, signal) => {
      const commandResults = await runner.runShowCommands(connection, commands, options.outputFormat, {
        signal,
        includeRawEntries: options.includeRaw === true
      });
      const firstResult = commandResults[0];

      return buildReadDeviceSuccess(host, {
        actual_output_format: firstResult?.output_format ?? "json",
        command_results: commandResults
      });
    },
    onError: (host, error) => buildReadDeviceFailure(host, "show_command_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    extra: {
      requested_output_format: options.outputFormat
    },
    responseSizeLimit: {
      config,
      operationName: "eos_run_show",
      narrowingGuidance: "Reduce the number of target devices, use fewer commands per request, or request text format for more concise output."
    }
  });
}

function normalizeShowCommands(commands: string[]): string[] {
  if (commands.length === 0) {
    throw new AppError("show_commands_missing", "runShow requires at least one command");
  }

  return commands.map((command) => normalizeShowCommand(command));
}
