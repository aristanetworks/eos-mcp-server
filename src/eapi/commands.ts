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

const EVENT_MONITOR_SQLITE_COMMAND_PATTERN = /^show\s+event-monitor\s+sqlite(?:\s+([\s\S]*))?$/i;
const SQL_STATEMENT_START_PATTERN = /^(?:select|with)(?![\w$])/i;
const SQL_FORBIDDEN_CHARACTER_PATTERN = /[`$&]/;
const SQL_SINGLE_PIPE_PATTERN = /(?<!\|)\|(?!\|)|\|{3,}/;
const SQL_REDIRECT_TO_LOCATION_PATTERN = />\s*[A-Za-z][\w-]*:/;
const SQL_REJECTION_SUFFIX = "only one read-only SELECT or WITH statement is allowed";

function rejectEventMonitorSql(reason: string): never {
  throw new AppError("event_monitor_sqlite_rejected", `Event monitor SQL rejected: ${reason}; ${SQL_REJECTION_SUFFIX}`);
}

export function normalizeEventMonitorSqlStatement(statement: string): string {
  let normalized = statement.trim();

  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must be a single line without control characters");
  }

  if (normalized.endsWith(";")) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  if (normalized.length === 0) {
    rejectEventMonitorSql("statement must not be empty");
  }

  if (normalized.includes(";")) {
    rejectEventMonitorSql("statement must not contain ';' other than one trailing ';'");
  }

  if (!SQL_STATEMENT_START_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must start with SELECT or WITH");
  }

  if (SQL_FORBIDDEN_CHARACTER_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must not contain '`', '$' or '&'");
  }

  if (SQL_SINGLE_PIPE_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must not contain a single '|' (only '||' concatenation is allowed)");
  }

  if (SQL_REDIRECT_TO_LOCATION_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must not contain '>' followed by a file location");
  }

  return normalized;
}

export function normalizeShowCommand(command: string): string {
  const sqliteMatch = EVENT_MONITOR_SQLITE_COMMAND_PATTERN.exec(command.trim());
  if (sqliteMatch) {
    return `show event-monitor sqlite ${normalizeEventMonitorSqlStatement(sqliteMatch[1] ?? "")}`;
  }

  const normalized = normalizeSingleLineEosInput(command, "show command");
  const lower = normalized.toLowerCase();

  if (lower !== "show" && !lower.startsWith("show ")) {
    throw new AppError("show_command_invalid", `Only show commands are allowed in eos_run_show: ${command}`);
  }

  return normalized;
}
