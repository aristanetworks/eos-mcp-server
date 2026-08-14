import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
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
import { readNumber, readString } from "../utils/value.js";

export interface GetFactsOptions {
  target: string;
  include_raw: boolean;
}

export interface GetFactsResult {
  target: string;
  target_type: "host" | "group";
  resolved_devices: string[];
  summary: DeviceResultSummary;
  results: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    status: "success" | "failed";
    facts?: {
      inventory_hostname: string;
      device_hostname?: string;
      model?: string;
      serial_number?: string;
      eos_version?: string;
      uptime?: number;
      system_mac?: string;
    };
    command_results?: EosCommandResult[];
    error_code?: string;
    message?: string;
  }>;
}

export async function getFacts(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: GetFactsOptions,
  reader: EosDeviceReader
): Promise<GetFactsResult> {
  const operation = await executeReadOperation<GetFactsResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_get_facts",
    run: async (host, signal) => {
      const commandResults = await reader.runShowCommands(host, ["show version"], "json", {
        signal,
        includeRawEntries: options.include_raw
      });
      const versionPayload = extractPrimaryPayload(commandResults);

      const factDeviceHostname = readString(versionPayload.hostname);
      const factModel = readString(versionPayload.modelName);
      const factSerialNumber = readString(versionPayload.serialNumber);
      const factEosVersion = readString(versionPayload.version);
      const factUptime = readNumber(versionPayload.uptime);
      const factSystemMac = readString(versionPayload.systemMacAddress);

      return buildReadDeviceSuccess(host, {
        facts: {
          inventory_hostname: host.inventoryHostname,
          ...(factDeviceHostname !== undefined ? { device_hostname: factDeviceHostname } : {}),
          ...(factModel !== undefined ? { model: factModel } : {}),
          ...(factSerialNumber !== undefined ? { serial_number: factSerialNumber } : {}),
          ...(factEosVersion !== undefined ? { eos_version: factEosVersion } : {}),
          ...(factUptime !== undefined ? { uptime: factUptime } : {}),
          ...(factSystemMac !== undefined ? { system_mac: factSystemMac } : {})
        },
        ...(options.include_raw ? { command_results: commandResults } : {})
      });
    },
    onError: (host, error) => buildReadDeviceFailure(host, "facts_collection_failed", error)
  });

  return buildReadOperationResultEnvelope(options.target, operation, {
    responseSizeLimit: {
      config,
      operationName: "eos_get_facts",
      narrowingGuidance: "Reduce the number of target devices or set include_raw to false to omit raw per-command eAPI entries."
    }
  });
}

function extractPrimaryPayload(commandResults: EosCommandResult[]): Record<string, unknown> {
  const first = commandResults[0]?.output;

  if (typeof first === "object" && first !== null) {
    return first as Record<string, unknown>;
  }

  throw new AppError("facts_payload_invalid", "Unexpected show version payload structure");
}
