import { AppError } from "../core/errors.js";

export type DiagnosticExecutionState = "not_dispatched" | "completed" | "unknown";

/** Explicit adapter classification; ordinary errors leave execution state unknown. */
export class DiagnosticExecutionError extends AppError {
  constructor(
    code: string,
    message: string,
    readonly executionState: DiagnosticExecutionState,
    details?: Record<string, unknown>
  ) {
    super(code, message, details);
  }
}
