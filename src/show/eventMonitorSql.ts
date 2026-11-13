import { AppError } from "../core/errors.js";
import { CONTROL_CHARACTER_PATTERN } from "../eapi/commands.js";

/**
 * Guard for Event SQL Queries (`show event-monitor sqlite <statement>`, ADR 0011). EOS opens the
 * event database read-only, but `ATTACH DATABASE` and `VACUUM INTO` still create files on flash, so
 * only one SELECT or WITH statement is accepted. The statement takes the rest of the line on EOS, so
 * it replaces the generic metacharacter check; the rules below still stop a pipe or redirect.
 */
const EVENT_MONITOR_SUBCOMMAND_PATTERN = /^show\s+event-monitor\s+([a-z]+)(?![\w-])\s*([\s\S]*)$/i;
const SQLITE_KEYWORD = "sqlite";
const SQL_STATEMENT_START_PATTERN = /^(?:select|with)(?![\w$])/i;
const SQL_FORBIDDEN_CHARACTER_PATTERN = /[`$&]/;
const SQL_SINGLE_PIPE_PATTERN = /(?<!\|)\|(?!\|)|\|{3,}/;
const SQL_REDIRECT_TO_LOCATION_PATTERN = />\s*[A-Za-z][\w-]*:/;

/** Checked in order after control characters, the trailing ';' and emptiness, so each input keeps one stable message. */
const SQL_STATEMENT_RULES: ReadonlyArray<readonly [isViolation: (statement: string) => boolean, reason: string]> = [
  [(statement) => statement.includes(";"), "statement must not contain ';' other than one trailing ';'"],
  [(statement) => !SQL_STATEMENT_START_PATTERN.test(statement), "statement must start with SELECT or WITH"],
  [(statement) => SQL_FORBIDDEN_CHARACTER_PATTERN.test(statement), "statement must not contain '`', '$' or '&'"],
  [(statement) => SQL_SINGLE_PIPE_PATTERN.test(statement), "statement must not contain a single '|' (only '||' concatenation is allowed)"],
  [(statement) => SQL_REDIRECT_TO_LOCATION_PATTERN.test(statement), "statement must not contain '>' followed by a file location"]
];

/**
 * The normalized command when `command` is an Event SQL Query, otherwise undefined. The interactive
 * CLI accepts keyword prefixes; eAPI on cEOS 4.34.3M rejects them ("Incomplete token"), but other
 * releases may not, so every prefix of `sqlite` (down to a lone `s`) counts, failing closed, and is
 * rewritten to the full keyword.
 */
export function normalizeEventMonitorSqlCommand(command: string): string | undefined {
  const subcommandMatch = EVENT_MONITOR_SUBCOMMAND_PATTERN.exec(command.trim());
  const subcommandKeyword = subcommandMatch?.[1]?.toLowerCase();
  if (subcommandKeyword === undefined || !SQLITE_KEYWORD.startsWith(subcommandKeyword)) {
    return undefined;
  }
  return `show event-monitor ${SQLITE_KEYWORD} ${normalizeEventMonitorSqlStatement(subcommandMatch?.[2] ?? "")}`;
}

export function normalizeEventMonitorSqlStatement(statement: string): string {
  let normalizedStatement = statement.trim();

  // Checked before the trailing ';' is stripped so a control character always reports the same reason.
  if (CONTROL_CHARACTER_PATTERN.test(normalizedStatement)) {
    rejectEventMonitorSql("statement must be a single line without control characters");
  }
  if (normalizedStatement.endsWith(";")) {
    normalizedStatement = normalizedStatement.slice(0, -1).trimEnd();
  }
  if (normalizedStatement.length === 0) {
    rejectEventMonitorSql("statement must not be empty");
  }
  for (const [isViolation, reason] of SQL_STATEMENT_RULES) {
    if (isViolation(normalizedStatement)) {
      rejectEventMonitorSql(reason);
    }
  }

  return normalizedStatement;
}

function rejectEventMonitorSql(reason: string): never {
  throw new AppError(
    "event_monitor_sqlite_rejected",
    `Event monitor SQL rejected: ${reason}; only one read-only SELECT or WITH statement is allowed`
  );
}
