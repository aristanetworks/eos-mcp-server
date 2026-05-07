import { AppError } from "../core/errors.js";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function normalizeSingleLineEosInput(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError("eos_input_empty", `${label} must not be empty`);
  }

  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new AppError("eos_input_invalid", `${label} must be a single line without control characters`);
  }

  return normalized;
}

export function normalizeShowCommand(command: string): string {
  const normalized = normalizeSingleLineEosInput(command, "show command");
  const lower = normalized.toLowerCase();

  if (lower !== "show" && !lower.startsWith("show ")) {
    throw new AppError("show_command_invalid", `Only show commands are allowed in eos_run_show: ${command}`);
  }

  return normalized;
}
