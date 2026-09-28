import { AppError } from "../core/errors.js";
import { isObject } from "../utils/value.js";

export type EapiOutputFormat = "json" | "text";
export type EapiOutputMode = EapiOutputFormat | "auto";
export type EapiVersion = 1 | "latest";

export interface EapiConnectionConfig {
  inventoryHostname: string;
  endpointHost: string;
  baseUrl: string;
  username: string;
  password: string;
  validateCerts: boolean;
  caFile?: string;
  timeoutMs: number;
  eapiVersion: EapiVersion;
  maxResponseSizeBytes?: number;
}

export interface EapiCommandOptions {
  enable?: boolean;
  signal?: AbortSignal;
}

export interface RunShowCommandOptions extends EapiCommandOptions {
  includeRawEntries?: boolean;
}

export interface EosCommandResult {
  command: string;
  output_format: EapiOutputFormat;
  output: unknown;
  raw_entry?: unknown;
}

export interface EosCommandRunner {
  runShowCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    outputMode: EapiOutputMode,
    options?: RunShowCommandOptions
  ): Promise<EosCommandResult[]>;
}

export function hasEapiResultArray(payload: unknown): payload is { result: unknown[] } {
  return isObject(payload) && "result" in payload && Array.isArray(payload.result);
}

export interface EapiRunCmdsResponse {
  result: unknown[];
  raw: unknown;
}

export function parseEapiRunCmdsResponse(payload: unknown, expectedResultCount?: number): EapiRunCmdsResponse {
  if (!hasEapiResultArray(payload)) {
    throw new AppError("eapi_payload_invalid", "Unexpected eAPI payload structure: missing result array");
  }

  if (expectedResultCount !== undefined && payload.result.length !== expectedResultCount) {
    throw new AppError(
      "eapi_payload_invalid",
      `Unexpected eAPI payload structure: expected ${expectedResultCount} result entries but received ${payload.result.length}`
    );
  }

  return { result: payload.result, raw: payload };
}

export interface EapiJsonRpcRequest {
  jsonrpc: "2.0";
  method: "runCmds";
  params: {
    version: EapiVersion;
    cmds: string[];
    format: EapiOutputFormat;
  };
  id: string;
}
