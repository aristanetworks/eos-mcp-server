import { AppError, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, executeReadOperation } from "../operations/readExecution.js";

export interface RunningConfigRunner {
  runShowCommands(connection: EapiConnectionConfig, commands: string[], format: "json" | "text"): Promise<unknown>;
}

export interface GetRunningConfigOptions {
  target: string;
  section?: string;
}

export interface GetRunningConfigResult {
  target: string;
  target_type: "host" | "group";
  section_requested: string | null;
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
    config_text?: string;
    error_code?: string;
    message?: string;
  }>;
}

export async function getRunningConfig(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: GetRunningConfigOptions,
  runner: RunningConfigRunner
): Promise<GetRunningConfigResult> {
  const command = options.section ? `show running-config section ${options.section}` : "show running-config";
  const operation = await executeReadOperation<GetRunningConfigResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_get_running_config",
    validateTarget: (resolvedTarget) => {
      if (resolvedTarget.targetType === "group" && !options.section) {
        throw new AppError("running_config_section_required", "Group targets for eos_get_running_config require a section");
      }
    },
    run: async (host, connection) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "success",
      config_text: extractConfigText(await runner.runShowCommands(connection, [command], "text"))
    }),
    onError: (host, error) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "failed",
      error_code: "running_config_failed",
      message: toErrorMessage(error)
    })
  });

  return {
    ...buildReadOperationResultEnvelope(options.target, operation),
    section_requested: options.section ?? null
  };
}

function extractConfigText(rawResult: unknown): string {
  if (
    typeof rawResult === "object" &&
    rawResult !== null &&
    "result" in rawResult &&
    Array.isArray((rawResult as { result: unknown }).result)
  ) {
    const first = (rawResult as { result: unknown[] }).result[0];
    if (typeof first === "string") {
      return first;
    }
    if (typeof first === "object" && first !== null && "output" in first && typeof (first as { output: unknown }).output === "string") {
      return (first as { output: string }).output;
    }
  }

  throw new AppError("running_config_payload_invalid", "Unexpected running-config payload structure");
}
