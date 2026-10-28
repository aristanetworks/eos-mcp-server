import type { ResolvedServerConfig } from "../config/schema.js";
import { resolveEapiConnection } from "../connection/resolveConnection.js";
import { AppError, toErrorCode, toErrorMessage } from "../core/errors.js";
import type { EosTextCommandRunner } from "../eapi/types.js";
import type { InventoryHostModel } from "../inventory/types.js";
import { isObject } from "../utils/value.js";
import { DiagnosticExecutionError } from "./executionError.js";
import { buildPingCommand } from "./ping.js";
import type { DiagnosticDeviceRunner, DiagnosticExecutionContext, DiagnosticObservation, PreparedDiagnostic } from "./types.js";

export class EapiDiagnosticRunner implements DiagnosticDeviceRunner {
  constructor(private readonly config: ResolvedServerConfig, private readonly runner: EosTextCommandRunner) {}

  async execute(host: InventoryHostModel, request: PreparedDiagnostic, context: DiagnosticExecutionContext): Promise<DiagnosticObservation> {
    let dispatched = false;
    try {
      const connection = {
        ...resolveEapiConnection(this.config, host),
        timeoutMs: this.config.diagnostics.httpTimeoutMs
      };
      dispatched = true;
      const results = await this.runner.runTextCommands(connection, [buildPingCommand(request)], { enable: true, signal: context.signal, requestId: context.requestId });
      const output = results[0]?.output;
      if (results.length !== 1 || typeof output !== "string") {
        throw new DiagnosticExecutionError("diagnostic_output_unrecognized", "Expected one text result from EOS", "unknown");
      }
      return { kind: request.kind, output };
    } catch (error) {
      // Only confirmed synchronous results/rejections prove completion. An invalid
      // payload or HTTP response cannot establish whether remote work is pending.
      const code = toErrorCode(error, "diagnostic_execution_failed");
      const executionState = dispatched ? "unknown" : "not_dispatched";
      const responseError = ["eapi_json_rpc_error", "json_output_unavailable", "eapi_http_error", "eapi_response_invalid_json"].includes(code);
      if (executionState !== "unknown" || responseError) {
        const data = error instanceof AppError ? error.details?.data : undefined;
        const text = Array.isArray(data)
          ? data.filter(isObject).map((entry) => entry.output).filter((entry): entry is string => typeof entry === "string").join("")
          : undefined;
        throw new DiagnosticExecutionError(code, responseError ? `EOS diagnostic request failed (${code})` : toErrorMessage(error), executionState, {
          // Preserve EOS error evidence internally; only the executor's explicit
          // includeRaw path may expose it. RPC error messages contain raw data.
          ...(responseError ? { raw_output: text || toErrorMessage(error) } : {})
        });
      }
      throw error;
    }
  }
}
