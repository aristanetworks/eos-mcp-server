import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { normalizeSingleLineEosInput } from "../eapi/commands.js";
import type { EosCommandResult } from "../eapi/types.js";
import type { EosDeviceReader } from "../connection/eosDeviceReader.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  executeReadOperation,
  type DeviceResultSummary
} from "../operations/readExecution.js";

export interface GetRunningConfigOptions {
  target: string;
  section?: string;
}

export interface GetRunningConfigResult {
  target: string;
  target_type: "host" | "group";
  section_requested: string | null;
  resolved_devices: string[];
  summary: DeviceResultSummary;
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
  reader: EosDeviceReader
): Promise<GetRunningConfigResult> {
  const section = options.section !== undefined ? normalizeSingleLineEosInput(options.section, "running config section") : undefined;
  const command = section ? `show running-config section ${section}` : "show running-config";
  const operation = await executeReadOperation<GetRunningConfigResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_get_running_config",
    validateTarget: (resolvedTarget) => {
      if (resolvedTarget.targetType === "group" && !section) {
        throw new AppError("running_config_section_required", "Group targets for eos_get_running_config require a section");
      }
    },
    run: async (host, signal) =>
      buildReadDeviceSuccess(host, {
        config_text: extractConfigText(await reader.runShowCommands(host, [command], "text", { enable: true, signal }))
      }),
    onError: (host, error) => buildReadDeviceFailure(host, "running_config_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    extra: {
      section_requested: section ?? null
    },
    responseSizeLimit: {
      config,
      operationName: "eos_get_running_config",
      narrowingGuidance: "Use a section filter to retrieve only the relevant portion of the running config (e.g., section \"router bgp\")."
    }
  });
}

function extractConfigText(commandResults: EosCommandResult[]): string {
  const first = commandResults[0]?.output;

  if (typeof first === "string") {
    return first;
  }

  throw new AppError("running_config_payload_invalid", "Unexpected running-config payload structure");
}
