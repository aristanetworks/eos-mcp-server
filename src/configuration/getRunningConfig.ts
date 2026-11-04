import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { normalizeSingleLineEosInput } from "../eapi/commands.js";
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

export interface GetRunningConfigOptions {
  target: string;
  section?: string;
}

export type GetRunningConfigDeviceResult = DeviceResult<{
  config_text: string;
}>;

export type GetRunningConfigResult = TargetOperationResult<GetRunningConfigDeviceResult> & {
  section_requested: string | null;
};

export async function getRunningConfig(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: GetRunningConfigOptions,
  reader: EosDeviceReader,
  signal?: AbortSignal
): Promise<GetRunningConfigResult> {
  const section = options.section !== undefined ? normalizeSingleLineEosInput(options.section, "running config section") : undefined;
  const command = section ? `show running-config section ${section}` : "show running-config";
  return runTargetOperation(model, config, {
    target: options.target,
    operationName: "eos_get_running_config",
    ...readOperationLimits(config),
    ...(signal !== undefined ? { signal } : {}),
    validateTarget: (resolvedTarget) => {
      if (resolvedTarget.targetType === "group" && !section) {
        throw new AppError("running_config_section_required", "Group targets for eos_get_running_config require a section");
      }
    },
    run: async (host, signal): Promise<Array<GetRunningConfigResult["results"][number]>> => [
      buildDeviceSuccess(host, {
        config_text: extractConfigText(await reader.runShowCommands(host, [command], "text", { enable: true, signal }))
      })
    ],
    failureCode: "running_config_failed",
    extra: {
      section_requested: section ?? null
    },
    narrowingGuidance: "Use a section filter to retrieve only the relevant portion of the running config (e.g., section \"router bgp\")."
  });
}

function extractConfigText(commandResults: EosCommandResult[]): string {
  const first = commandResults[0]?.output;

  if (typeof first === "string") {
    return first;
  }

  throw new AppError("running_config_payload_invalid", "Unexpected running-config payload structure");
}
