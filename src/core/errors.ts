export class AppError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function getErrorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

export function toErrorCode(error: unknown, fallback = "unknown_error"): string {
  return getErrorCode(error) ?? fallback;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
