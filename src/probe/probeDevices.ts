import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult } from "../eapi/types.js";
import type { EosDeviceReader } from "../connection/eosDeviceReader.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildDeviceSuccess,
  readOperationLimits,
  runTargetOperation,
  type DeviceResultSummary
} from "../operations/targetOperation.js";

export interface ProbeDevicesOptions {
  target: string;
  include_raw: boolean;
}

export interface ProbeDevicesResult {
  target: string;
  target_type: "host" | "group";
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    status: "success" | "failed";
    error_code?: string;
    message?: string;
    command_results?: EosCommandResult[];
  }>;
}

export async function probeDevices(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: ProbeDevicesOptions,
  reader: EosDeviceReader,
  signal?: AbortSignal
): Promise<ProbeDevicesResult> {
  return runTargetOperation<ProbeDevicesResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_probe_devices",
    ...readOperationLimits(config),
    ...(signal !== undefined ? { signal } : {}),
    run: async (host, signal) => {
      const commandResults = await reader.runShowCommands(host, ["show version"], "json", {
        signal,
        includeRawEntries: options.include_raw
      });
      return [buildDeviceSuccess(host, {
        ...(options.include_raw ? { command_results: commandResults } : {})
      })];
    },
    failureCode: "probe_failed"
  });
}
