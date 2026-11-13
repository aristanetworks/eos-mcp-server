import { AppError } from "../core/errors.js";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RISKY_CLI_META_PATTERN = /[|><;&`$]/;

export function normalizeSingleLineEosInput(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError("eos_input_empty", `${label} must not be empty`);
  }

  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new AppError("eos_input_invalid", `${label} must be a single line without control characters`);
  }

  if (RISKY_CLI_META_PATTERN.test(normalized)) {
    throw new AppError("eos_input_invalid", `${label} must not contain CLI output modifiers or shell metacharacters`);
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
