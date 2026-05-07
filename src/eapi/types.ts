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

export function extractEapiResults(payload: unknown): unknown[] {
  if (hasEapiResultArray(payload)) {
    return payload.result;
  }

  throw new AppError("eapi_payload_invalid", "Unexpected eAPI payload structure: missing result array");
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
