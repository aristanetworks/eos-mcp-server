import { AppError, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { extractEapiResults, type EosCommandRunner } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, executeReadOperation, type DeviceResultSummary } from "../operations/readExecution.js";
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
    raw_result?: unknown;
    error_code?: string;
    message?: string;
  }>;
}

export async function getFacts(
  model: InventoryModel,
  config: ResolvedServerConfig,
  options: GetFactsOptions,
  runner: EosCommandRunner
): Promise<GetFactsResult> {
  const operation = await executeReadOperation<GetFactsResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_get_facts",
    responseSizeGuidance: "Reduce the number of target devices or set include_raw to false to omit raw device payloads.",
    run: async (host, connection) => {
      const rawResult = await runner.runShowCommands(connection, ["show version"], "json");
      const versionPayload = extractPrimaryPayload(rawResult);

      const factDeviceHostname = readString(versionPayload.hostname);
      const factModel = readString(versionPayload.modelName);
      const factSerialNumber = readString(versionPayload.serialNumber);
      const factEosVersion = readString(versionPayload.version);
      const factUptime = readNumber(versionPayload.uptime);
      const factSystemMac = readString(versionPayload.systemMacAddress);

      return {
        inventory_hostname: host.inventoryHostname,
        resolved_endpoint: host.resolvedEndpoint,
        status: "success",
        facts: {
          inventory_hostname: host.inventoryHostname,
          ...(factDeviceHostname !== undefined ? { device_hostname: factDeviceHostname } : {}),
          ...(factModel !== undefined ? { model: factModel } : {}),
          ...(factSerialNumber !== undefined ? { serial_number: factSerialNumber } : {}),
          ...(factEosVersion !== undefined ? { eos_version: factEosVersion } : {}),
          ...(factUptime !== undefined ? { uptime: factUptime } : {}),
          ...(factSystemMac !== undefined ? { system_mac: factSystemMac } : {})
        },
        ...(options.include_raw ? { raw_result: rawResult } : {})
      };
    },
    onError: (host, error) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      status: "failed",
      error_code: "facts_collection_failed",
      message: toErrorMessage(error)
    })
  });

  return buildReadOperationResultEnvelope(options.target, operation);
}

function extractPrimaryPayload(rawResult: unknown): Record<string, unknown> {
  const results = extractEapiResults(rawResult);
  const first = results[0];

  if (typeof first === "object" && first !== null) {
    return first as Record<string, unknown>;
  }

  throw new AppError("facts_payload_invalid", "Unexpected show version payload structure");
}

