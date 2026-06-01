import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult, EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import {
  buildReadDeviceFailure,
  buildReadDeviceSuccess,
  buildReadOperationResultEnvelope,
  executeReadOperation,
  type DeviceResultSummary
} from "../operations/readExecution.js";

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
  runner: EosCommandRunner
): Promise<ProbeDevicesResult> {
  const operation = await executeReadOperation<ProbeDevicesResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_probe_devices",
    run: async (host, connection, signal) => {
      const commandResults = await runner.runShowCommands(connection, ["show version"], "json", {
        signal,
        includeRawEntries: options.include_raw
      });
      return buildReadDeviceSuccess(host, {
        ...(options.include_raw ? { command_results: commandResults } : {})
      });
    },
    onError: (host, error) => buildReadDeviceFailure(host, "probe_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    responseSizeLimit: {
      config,
      operationName: "eos_probe_devices"
    }
  });
}
