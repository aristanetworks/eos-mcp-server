import { AppError } from "../core/errors.js";
import { isObject } from "../utils/value.js";

export type EapiOutputFormat = "json" | "text";

export interface EapiConnectionConfig {
  inventoryHostname: string;
  endpointHost: string;
  baseUrl: string;
  username: string;
  password: string;
  validateCerts: boolean;
  caFile?: string;
  timeoutMs: number;
  maxResponseSizeBytes?: number;
}

export interface EapiCommandOptions {
  enable?: boolean;
  signal?: AbortSignal;
}

export interface EosCommandRunner {
  runShowCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    format: EapiOutputFormat,
    options?: EapiCommandOptions
  ): Promise<unknown>;
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

export function extractEapiResults(payload: unknown): unknown[] {
  return parseEapiRunCmdsResponse(payload).result;
}

export function extractEapiTextOutput(entry: unknown): string | undefined {
  if (isObject(entry) && "output" in entry && typeof entry.output === "string") {
    return entry.output;
  }
  return undefined;
}

export interface EapiJsonRpcRequest {
  jsonrpc: "2.0";
  method: "runCmds";
  params: {
    version: 1;
    cmds: string[];
    format: EapiOutputFormat;
  };
  id: string;
}
