import type { ResolvedServerConfig } from "../config/schema.js";
import { resolveEapiConnection } from "../connection/resolveConnection.js";
import { AppError, toAppError, toErrorCode, toErrorMessage } from "../core/errors.js";
import type { EapiConnectionConfig, EosTextCommandRunner } from "../eapi/types.js";
import type { InventoryHostModel } from "../inventory/types.js";
import { isObject } from "../utils/value.js";
import { diagnosticDefinitions } from "./definitions.js";
import type { DiagnosticDeviceRunner, DiagnosticExecutionContext, DiagnosticOutcome, PreparedDiagnostic } from "./types.js";

/** eAPI errors whose details carry EOS's own text, kept as evidence. */
const EVIDENCE_ERROR_CODES = ["eapi_json_rpc_error", "json_output_unavailable", "eapi_http_error", "eapi_response_invalid_json"];

export class EapiDiagnosticRunner implements DiagnosticDeviceRunner {
  constructor(private readonly config: ResolvedServerConfig, private readonly runner: EosTextCommandRunner) {}

  async execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticOutcome> {
    const plan = diagnosticDefinitions[request.kind].eapiExecution(request, this.config.diagnostics);
    let connection: EapiConnectionConfig;
    try {
      connection = { ...resolveEapiConnection(this.config, host), timeoutMs: plan.httpTimeoutMs };
    } catch (error) {
      return { end: "failed", error: toAppError(error, "diagnostic_execution_failed"), remote: "not_dispatched" };
    }

    try {
      const results = await this.runner.runTextCommands(connection, [plan.command], {
        enable: true,
        // Only server shutdown or the HTTP timeout ends the request; see DiagnosticExecutionContext.
        signal: context.shutdownSignal,
        requestId: context.requestId,
        ...(plan.requestTimeoutSeconds === undefined ? {} : { requestTimeoutSeconds: plan.requestTimeoutSeconds })
      });
      const output = results[0]?.output;
      if (results.length !== 1 || typeof output !== "string") {
        return { end: "failed", error: new AppError("diagnostic_output_unrecognized", "Expected one text result from EOS"), remote: "unknown" };
      }
      return { end: "output", output };
    } catch (error) {
      // Each definition decides what the device timer means for its kind (a capture's expected end, a ping's failure).
      if (isDeviceTimeLimitError(error)) {
        return { end: "device_time_limit" };
      }
      // After dispatch, an error is never proof that remote work has stopped.
      const code = toErrorCode(error, "diagnostic_execution_failed");
      if (!EVIDENCE_ERROR_CODES.includes(code)) {
        return { end: "failed", error: toAppError(error, code), remote: "unknown" };
      }
      const data = error instanceof AppError ? error.details?.data : undefined;
      const text = Array.isArray(data)
        ? data.filter(isObject).map((entry) => entry.output).filter((entry): entry is string => typeof entry === "string").join("")
        : undefined;
      // RPC error messages contain raw EOS data, so the message is replaced and the text kept only as evidence.
      return {
        end: "failed",
        error: new AppError(code, `EOS diagnostic request failed (${code})`),
        remote: "unknown",
        evidence: text || toErrorMessage(error)
      };
    }
  }
}

const DEVICE_TIME_LIMIT_ERROR = "Command exceeded its allowed time limit";

/** EOS's answer when runCmds.requestTimeout stops the diagnostic command: RPC error 1001 whose data holds
 * a successful `enable` result, then the command's result carrying the time-limit error (error 408).
 * Measured on cEOS 4.34.3M. A time limit hit during `enable` leaves one entry and means the command
 * never ran, so it is not the device timer ending the command.
 */
function isDeviceTimeLimitError(error: unknown): boolean {
  if (!(error instanceof AppError) || error.details?.jsonRpcCode !== 1001) return false;
  const data = error.details.data;
  if (!Array.isArray(data) || data.length !== 2) return false;
  const [enableResult, commandResult] = data;
  return isObject(enableResult) && enableResult.errors === undefined &&
    isObject(commandResult) && Array.isArray(commandResult.errors) && commandResult.errors.includes(DEVICE_TIME_LIMIT_ERROR);
}
