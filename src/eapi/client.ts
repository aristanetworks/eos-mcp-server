import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import { isObject } from "../utils/value.js";
import { hasEapiResultArray, type EapiCommandOptions, type EapiConnectionConfig, type EapiJsonRpcRequest, type EapiOutputFormat } from "./types.js";
import { NodeHttpsEapiTransport, type EapiTransport } from "./transport.js";

export class EapiClient {
  private readonly transport: EapiTransport;

  constructor(transport: EapiTransport = new NodeHttpsEapiTransport()) {
    this.transport = transport;
  }

  async runShowCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    format: EapiOutputFormat,
    options?: EapiCommandOptions
  ): Promise<unknown> {
    return this.runCommands(connection, commands, format, options);
  }

  async runCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    format: EapiOutputFormat,
    options?: EapiCommandOptions
  ): Promise<unknown> {
    if (commands.length === 0) {
      throw new AppError("eapi_commands_missing", "runCommands requires at least one command");
    }

    const useEnable = options?.enable === true;
    const wireCommands = useEnable ? ["enable", ...commands] : commands;

    const requestBody: EapiJsonRpcRequest = {
      jsonrpc: "2.0",
      method: "runCmds",
      params: {
        version: 1,
        cmds: wireCommands,
        format
      },
      id: randomUUID()
    };

    const requestSignal = buildRequestSignal(connection.timeoutMs, options?.signal);

    const requestJson = JSON.stringify(requestBody);
    const response = await this.transport.postJson(connection, requestJson, requestSignal);

    if (!response.ok) {
      const text = await response.text();
      throw new AppError("eapi_http_error", `EOS eAPI request failed with status ${response.status}: ${text}`, {
        status: response.status
      });
    }

    const payload = await response.json();
    throwIfJsonRpcError(payload);

    if (useEnable) {
      return stripEnableResult(payload);
    }
    return payload;
  }
}

function buildRequestSignal(timeoutMs: number, callerSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);
}

function stripEnableResult(payload: unknown): unknown {
  if (hasEapiResultArray(payload)) {
    return { ...payload, result: payload.result.slice(1) };
  }
  return payload;
}

function throwIfJsonRpcError(payload: unknown): void {
  if (!isObject(payload) || !isObject(payload.error)) {
    return;
  }

  const message = typeof payload.error.message === "string" ? payload.error.message : "EOS eAPI JSON-RPC error";
  const code = typeof payload.error.code === "number" || typeof payload.error.code === "string" ? payload.error.code : "unknown";
  const data = payload.error.data;
  const details = data === undefined ? "" : `; data=${JSON.stringify(data)}`;
  throw new AppError(classifyJsonRpcErrorCode(message, data), `EOS eAPI JSON-RPC error ${String(code)}: ${message}${details}`, {
    jsonRpcCode: code,
    ...(data !== undefined ? { data } : {})
  });
}

function classifyJsonRpcErrorCode(message: string, data: unknown): string {
  const haystacks = [message, ...(Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === "string") : [])]
    .join(" ")
    .toLowerCase();

  if (haystacks.includes("json")) {
    return "json_output_unavailable";
  }

  return "eapi_json_rpc_error";
}
