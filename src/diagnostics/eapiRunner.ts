import type { ResolvedServerConfig } from "../config/schema.js";
import { resolveEapiConnection } from "../connection/resolveConnection.js";
import { AppError, toErrorCode, toErrorMessage } from "../core/errors.js";
import type { EapiConnectionConfig, EosTextCommandRunner } from "../eapi/types.js";
import type { InventoryHostModel } from "../inventory/types.js";
import { isObject } from "../utils/value.js";
import { DiagnosticExecutionError } from "./executionError.js";
import { diagnosticDefinitions } from "./definitions.js";
import type { DiagnosticDeviceRunner, DiagnosticExecutionContext, DiagnosticObservation, PreparedDiagnostic } from "./types.js";

export class EapiDiagnosticRunner implements DiagnosticDeviceRunner {
  constructor(private readonly config: ResolvedServerConfig, private readonly runner: EosTextCommandRunner) {}

  async execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticObservation> {
    const plan = diagnosticDefinitions[request.kind].eapiExecution(request, this.config.diagnostics);
    let connection: EapiConnectionConfig;
    try {
      connection = { ...resolveEapiConnection(this.config, host), timeoutMs: plan.httpTimeoutMs };
    } catch (error) {
      throw new DiagnosticExecutionError(toErrorCode(error, "diagnostic_execution_failed"), toErrorMessage(error), "not_dispatched");
    }

    try {
      const results = await this.runner.runTextCommands(connection, [plan.command], {
        enable: true,
        signal: context.signal,
        requestId: context.requestId,
        ...(plan.requestTimeoutSeconds === undefined ? {} : { requestTimeoutSeconds: plan.requestTimeoutSeconds })
      });
      const output = results[0]?.output;
      if (results.length !== 1 || typeof output !== "string") {
        throw new DiagnosticExecutionError("diagnostic_output_unrecognized", "Expected one text result from EOS", "unknown");
      }
      return { kind: request.kind, output };
    } catch (error) {
      if (request.kind === "packet_capture" && isDeviceTimeLimitError(error)) {
        return { kind: request.kind, deviceTimeLimitReached: true };
      }
      // After dispatch, an error is never proof that remote work has stopped.
      const code = toErrorCode(error, "diagnostic_execution_failed");
      if (!["eapi_json_rpc_error", "json_output_unavailable", "eapi_http_error", "eapi_response_invalid_json"].includes(code)) throw error;
      const data = error instanceof AppError ? error.details?.data : undefined;
      const text = Array.isArray(data)
        ? data.filter(isObject).map((entry) => entry.output).filter((entry): entry is string => typeof entry === "string").join("")
        : undefined;
      // Preserve EOS error evidence internally; only the executor's explicit
      // includeRaw path may expose it. RPC error messages contain raw data.
      throw new DiagnosticExecutionError(code, `EOS diagnostic request failed (${code})`, "unknown", {
        raw_output: text || toErrorMessage(error)
      });
    }
  }
}

const DEVICE_TIME_LIMIT_ERROR = "Command exceeded its allowed time limit";

/** EOS's answer when runCmds.requestTimeout stops the last command: RPC error 1001 whose final
 * data entry, that command's result, carries the time-limit error (error 408). Measured on cEOS 4.34.3M.
 */
function isDeviceTimeLimitError(error: unknown): boolean {
  if (!(error instanceof AppError) || error.details?.jsonRpcCode !== 1001) return false;
  const data = error.details.data;
  const commandResult = Array.isArray(data) ? data.at(-1) : undefined;
  return isObject(commandResult) && Array.isArray(commandResult.errors) && commandResult.errors.includes(DEVICE_TIME_LIMIT_ERROR);
}
