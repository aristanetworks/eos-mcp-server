import { toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, executeReadOperation } from "../operations/readExecution.js";

export interface ProbeRunner {
  runShowCommands(connection: EapiConnectionConfig, commands: string[], format: "json" | "text"): Promise<unknown>;
}

export interface ProbeDevicesOptions {
  target: string;
}

export interface ProbeDevicesResult {
  target: string;
  target_type: "host" | "group";
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
    error_code?: string;
    message?: string;
    raw_result?: unknown;
  }>;
}

export async function probeDevices(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: ProbeDevicesOptions,
  runner: ProbeRunner
): Promise<ProbeDevicesResult> {
  const operation = await executeReadOperation<ProbeDevicesResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_probe_devices",
    run: async (host, connection) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "success",
      raw_result: await runner.runShowCommands(connection, ["show version"], "json")
    }),
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
