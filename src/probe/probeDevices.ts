import { toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, executeReadOperation, type DeviceResultSummary } from "../operations/readExecution.js";

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
    raw_result?: unknown;
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
    run: async (host, connection) => {
      const showVersionResult = await runner.runShowCommands(connection, ["show version"], "json");
      return {
        inventory_hostname: host.inventoryHostname,
        resolved_endpoint: host.resolvedEndpoint,
        status: "success",
        ...(options.include_raw ? { raw_result: showVersionResult } : {})
      };
    },
    onError: (host, error) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "failed",
      error_code: "probe_failed",
      message: toErrorMessage(error)
    })
  });

  return buildReadOperationResultEnvelope(options.target, operation);
}
