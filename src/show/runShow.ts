import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { normalizeShowCommand } from "../eapi/commands.js";
import { normalizeEventMonitorSqlCommand } from "./eventMonitorSql.js";
import { isPrivilegedShowCommand } from "./privilegedShow.js";
import type { EosCommandResult } from "../eapi/types.js";
import type { EosDeviceReader } from "../connection/eosDeviceReader.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildDeviceSuccess,
  readOperationLimits,
  runTargetOperation,
  type DeviceResult,
  type TargetOperationResult
} from "../operations/targetOperation.js";

export interface RunShowOptions {
  target: string;
  commands: string[];
  outputFormat: "auto" | "json" | "text";
  includeRaw?: boolean;
}

export type NormalizedCommandResult = EosCommandResult & { privileged?: true };

export type RunShowDeviceResult = DeviceResult<{
  actual_output_format: EosCommandResult["output_format"];
  command_results: NormalizedCommandResult[];
}>;

export type RunShowResult = TargetOperationResult<RunShowDeviceResult> & {
  requested_output_format: RunShowOptions["outputFormat"];
};

export async function runShow(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: RunShowOptions,
  reader: EosDeviceReader,
  signal?: AbortSignal
): Promise<RunShowResult> {
  const commands = normalizeShowCommands(options.commands);
  enforceShowCommandLimit(config, commands.length);
  const runPrivileged = resolvePrivilegedRequest(config, commands);
  // EOS serves no JSON for Privileged Show Commands, so `auto` would only waste a privileged JSON attempt per host.
  const deviceOutputFormat = runPrivileged && options.outputFormat === "auto" ? "text" : options.outputFormat;

  return runTargetOperation<RunShowResult["results"][number], { requested_output_format: RunShowOptions["outputFormat"] }>(model, config, {
    target: options.target,
    operationName: "eos_run_show",
    ...readOperationLimits(config),
    ...(signal !== undefined ? { signal } : {}),
    run: async (host, signal) => {
      const deviceResults = await reader.runShowCommands(host, commands, deviceOutputFormat, {
        signal,
        includeRawEntries: options.includeRaw === true,
        ...(runPrivileged ? { enable: true } : {})
      });
      const commandResults: NormalizedCommandResult[] = runPrivileged
        ? deviceResults.map((deviceResult) => ({ ...deviceResult, privileged: true as const }))
        : deviceResults;
      const firstResult = commandResults[0];

      return [buildDeviceSuccess(host, {
        actual_output_format: firstResult?.output_format ?? "json",
        command_results: commandResults
      })];
    },
    failureCode: "show_command_failed",
    extra: {
      requested_output_format: options.outputFormat
    },
    narrowingGuidance: "Reduce the number of target devices, use fewer commands per request, request text format for more concise output, or add `limit N` or `match-time` to event-monitor commands (or SQL LIMIT)."
  });
}

function resolvePrivilegedRequest(config: ResolvedServerConfig, commands: string[]): boolean {
  const privilegedCommandCount = commands.filter((command) => isPrivilegedShowCommand(command, config.privilegedShowCommands)).length;
  if (privilegedCommandCount === 0) {
    return false;
  }
  if (privilegedCommandCount < commands.length) {
    throw new AppError(
      "show_command_privilege_mixed",
      `Privileged show commands (${config.privilegedShowCommands.join(", ")}) must be sent in their own request, not mixed with other commands`
    );
  }
  return true;
}

function enforceShowCommandLimit(config: ResolvedServerConfig, commandCount: number): void {
  if (commandCount > config.maxShowCommandsPerRequest) {
    throw new AppError(
      "show_command_limit_exceeded",
      `Show command count ${commandCount} exceeds configured maxShowCommandsPerRequest ${config.maxShowCommandsPerRequest}`
    );
  }
}

function normalizeShowCommands(commands: string[]): string[] {
  if (commands.length === 0) {
    throw new AppError("show_commands_missing", "runShow requires at least one command");
  }

  return commands.map((command) => normalizeEventMonitorSqlCommand(command) ?? normalizeShowCommand(command));
}
