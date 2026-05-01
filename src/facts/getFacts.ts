import { AppError, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import type { InventoryModel } from "../inventory/types.js";
import { buildReadOperationResultEnvelope, executeReadOperation } from "../operations/readExecution.js";
import { readString } from "../utils/value.js";

export interface FactsRunner {
  runShowCommands(connection: EapiConnectionConfig, commands: string[], format: "json" | "text"): Promise<unknown>;
}

export interface GetFactsOptions {
  target: string;
  include_raw: boolean;
}

export interface GetFactsResult {
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
  runner: FactsRunner
): Promise<GetFactsResult> {
  const operation = await executeReadOperation<GetFactsResult["results"][number]>(model, config, {
    target: options.target,
    operationName: "eos_get_facts",
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
  if (
    typeof rawResult === "object" &&
    rawResult !== null &&
    "result" in rawResult &&
    Array.isArray((rawResult as { result: unknown }).result) &&
    typeof (rawResult as { result: unknown[] }).result[0] === "object" &&
    (rawResult as { result: unknown[] }).result[0] !== null
  ) {
    return (rawResult as { result: Array<Record<string, unknown>> }).result[0] ?? {};
  }

  throw new AppError("facts_payload_invalid", "Unexpected show version payload structure");
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
