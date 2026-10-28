import { randomUUID } from "node:crypto";
import { AppError, getErrorCode } from "../core/errors.js";
import { isObject } from "../utils/value.js";
import {
  hasEapiResultArray,
  parseEapiRunCmdsResponse,
  type EapiCommandOptions,
  type EapiConnectionConfig,
  type EapiJsonRpcRequest,
  type EapiOutputFormat,
  type EapiOutputMode,
  type EosCommandResult,
  type RunShowCommandOptions,
  type RunTextCommandOptions
} from "./types.js";
import { NodeHttpsEapiTransport, type EapiTransport } from "./transport.js";

export class EapiClient {
  private readonly transport: EapiTransport;

  constructor(transport: EapiTransport = new NodeHttpsEapiTransport()) {
    this.transport = transport;
  }

  async runShowCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    outputMode: EapiOutputMode,
    options?: RunShowCommandOptions
  ): Promise<EosCommandResult[]> {
    const run = async (format: EapiOutputFormat): Promise<EosCommandResult[]> => {
      const payload = await this.runCommands(connection, commands, format, options);
      return buildCommandResults(payload, commands, format, options?.includeRawEntries === true);
    };

    if (outputMode === "json" || outputMode === "text") {
      return run(outputMode);
    }

    try {
      return await run("json");
    } catch (error) {
      if (getErrorCode(error) !== "json_output_unavailable") {
        throw error;
      }
      return run("text");
    }
  }

  /** Execute once in text mode. Active diagnostics must never use JSON fallback retries. */
  async runTextCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    options?: RunTextCommandOptions
  ): Promise<EosCommandResult[]> {
    const payload = await this.runCommands(connection, commands, "text", options, options?.requestId);
    return buildCommandResults(payload, commands, "text", false);
  }

  private async runCommands(
    connection: EapiConnectionConfig,
    commands: string[],
    format: EapiOutputFormat,
    options?: EapiCommandOptions,
    requestId: string = randomUUID()
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
        version: connection.eapiVersion,
        cmds: wireCommands,
        format
      },
      id: requestId
    };

    const requestSignal = buildRequestSignal(connection.timeoutMs, options?.signal);

    const requestJson = JSON.stringify(requestBody);
    let response;
    try {
      response = await this.transport.postJson(connection, requestJson, requestSignal);
    } catch (error) {
      throw classifyTransportError(error, requestSignal, connection);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new AppError("eapi_http_error", `EOS eAPI request failed with status ${response.status}: ${text}`, {
        status: response.status
      });
    }

    const payload = await parseJsonResponse(response, connection);
    if (!isObject(payload) || payload.jsonrpc !== "2.0" || payload.id !== requestBody.id) {
      throw new AppError("eapi_response_uncorrelated", "EOS response must use JSON-RPC 2.0 and match the exact request ID; remote completion is unknown");
    }
    if (Object.hasOwn(payload, "result") === Object.hasOwn(payload, "error")) {
      throw new AppError("eapi_payload_invalid", "EOS response must contain exactly one result or error member; remote completion is unknown");
    }
    throwIfJsonRpcError(payload);

    const normalizedPayload = useEnable ? stripEnableResult(payload) : payload;
    parseEapiRunCmdsResponse(normalizedPayload, commands.length);
    return normalizedPayload;
  }
}

function buildRequestSignal(timeoutMs: number, callerSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);
}

function buildCommandResults(
  payload: unknown,
  commands: string[],
  outputFormat: EapiOutputFormat,
  includeRawEntries: boolean
): EosCommandResult[] {
  const entries = parseEapiRunCmdsResponse(payload, commands.length).result;

  return commands.map((command, index) => {
    const rawEntry = entries[index];
    const output = outputFormat === "text" ? extractStrictTextOutput(rawEntry, command) : rawEntry;
    return {
      command,
      output_format: outputFormat,
      output,
      ...(includeRawEntries ? { raw_entry: rawEntry } : {})
    };
  });
}

function extractStrictTextOutput(entry: unknown, command: string): string {
  if (typeof entry === "string") {
    return entry;
  }

  if (isObject(entry) && typeof entry.output === "string") {
    return entry.output;
  }

  throw new AppError("eapi_text_output_invalid", `Unexpected text output payload for command ${command}`);
}

async function parseJsonResponse(response: { json(): Promise<unknown> }, connection: EapiConnectionConfig): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("eapi_response_invalid_json", `EOS eAPI response for host ${connection.inventoryHostname} was not valid JSON: ${message}`, {
      inventoryHostname: connection.inventoryHostname
    });
  }
}

function classifyTransportError(error: unknown, signal: AbortSignal, connection: EapiConnectionConfig): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (signal.aborted) {
    const reason = signal.reason;
    if (reason instanceof AppError) {
      return reason;
    }

    if (isTimeoutAbortReason(reason)) {
      return new AppError(
        "eapi_request_timeout",
        `EOS eAPI request for host ${connection.inventoryHostname} exceeded timeout ${connection.timeoutMs} ms`,
        {
          inventoryHostname: connection.inventoryHostname,
          timeoutMs: connection.timeoutMs
        }
      );
    }

    return new AppError("eapi_request_aborted", `EOS eAPI request for host ${connection.inventoryHostname} was aborted`, {
      inventoryHostname: connection.inventoryHostname
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AppError("eapi_transport_error", `EOS eAPI transport error for host ${connection.inventoryHostname}: ${message}`, {
    inventoryHostname: connection.inventoryHostname
  });
}

function isTimeoutAbortReason(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
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
  throw new AppError(classifyJsonRpcErrorCode(message, data, code), `EOS eAPI JSON-RPC error ${String(code)}: ${message}${details}`, {
    jsonRpcCode: code,
    ...(data !== undefined ? { data } : {})
  });
}

function classifyJsonRpcErrorCode(message: string, data: unknown, code: number | string): string {
  const haystacks = [message, ...(Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === "string") : [])]
    .join(" ")
    .toLowerCase();

  if (haystacks.includes("json") || (code === 1003 && message.toLowerCase().includes("unconverted command"))) {
    return "json_output_unavailable";
  }

  return "eapi_json_rpc_error";
}
