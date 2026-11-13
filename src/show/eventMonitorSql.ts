import { AppError } from "../core/errors.js";

/**
 * Guard for Event SQL Queries (`show event-monitor sqlite <statement>`, ADR 0011). EOS opens the
 * event database read-only, but `ATTACH DATABASE` and `VACUUM INTO` still create files on flash, so
 * only one SELECT or WITH statement is accepted. The statement takes the rest of the line on EOS, so
 * it replaces the generic metacharacter check; the rules below still stop a pipe or redirect.
 */
const EVENT_MONITOR_SQLITE_COMMAND_PATTERN = /^show\s+event-monitor\s+sqlite\b\s*([\s\S]*)$/i;
const SQL_STATEMENT_START_PATTERN = /^(?:select|with)(?![\w$])/i;

const SQL_FORBIDDEN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u0000-\u001f\u007f]/, "statement must be a single line without control characters"],
  [/;/, "statement must not contain ';' other than one trailing ';'"],
  [/[`$&]/, "statement must not contain '`', '$' or '&'"],
  [/(?<!\|)\|(?!\|)|\|{3,}/, "statement must not contain a single '|' (only '||' concatenation is allowed)"],
  [/>\s*[A-Za-z][\w-]*:/, "statement must not contain '>' followed by a file location"]
];

/** The normalized command when `command` is an Event SQL Query, otherwise undefined. */
export function normalizeEventMonitorSqlCommand(command: string): string | undefined {
  const sqliteMatch = EVENT_MONITOR_SQLITE_COMMAND_PATTERN.exec(command.trim());
  return sqliteMatch === null ? undefined : `show event-monitor sqlite ${normalizeEventMonitorSqlStatement(sqliteMatch[1] ?? "")}`;
}

export function normalizeEventMonitorSqlStatement(statement: string): string {
  const normalized = statement.trim().replace(/\s*;$/, "");

  if (normalized.length === 0) {
    rejectEventMonitorSql("statement must not be empty");
  }
  if (!SQL_STATEMENT_START_PATTERN.test(normalized)) {
    rejectEventMonitorSql("statement must start with SELECT or WITH");
  }
  for (const [forbiddenPattern, reason] of SQL_FORBIDDEN_PATTERNS) {
    if (forbiddenPattern.test(normalized)) {
      rejectEventMonitorSql(reason);
    }
  }

  return normalized;
}

function rejectEventMonitorSql(reason: string): never {
  throw new AppError(
    "event_monitor_sqlite_rejected",
    `Event monitor SQL rejected: ${reason}; only one read-only SELECT or WITH statement is allowed`
  );
}
