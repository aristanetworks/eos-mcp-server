import { describe, expect, it } from "vitest";
import { normalizeShowCommand } from "../src/eapi/commands.js";
import { normalizeEventMonitorSqlCommand, normalizeEventMonitorSqlStatement } from "../src/show/eventMonitorSql.js";

const SQLITE_PREFIX = "show event-monitor sqlite";
const sqlRejection = expect.objectContaining({
  code: "event_monitor_sqlite_rejected",
  message: expect.stringMatching(/only one read-only SELECT or WITH statement is allowed$/)
});

describe("event monitor SQL guard", () => {
  it.each([
    "select * from route limit 3",
    "SELECT count(*) FROM arp",
    "with recent as (select counter from route) select max(counter) from recent",
    "select counter from route where counter > 97",
    "select 'a' || 'b'",
    "select x from t where a <> b and c < 2",
    "select a from t where a >= b"
  ])("accepts %j", (statement) => {
    expect(normalizeEventMonitorSqlStatement(statement)).toBe(statement);
    expect(normalizeEventMonitorSqlCommand(`${SQLITE_PREFIX} ${statement}`)).toBe(`${SQLITE_PREFIX} ${statement}`);
  });

  it("strips exactly one trailing semicolon and surrounding whitespace", () => {
    expect(normalizeEventMonitorSqlStatement("select 1;")).toBe("select 1");
    expect(normalizeEventMonitorSqlStatement("select 1 ;  ")).toBe("select 1");
    expect(normalizeEventMonitorSqlCommand(`${SQLITE_PREFIX} select 1;`)).toBe(`${SQLITE_PREFIX} select 1`);
  });

  it("matches the keywords case-insensitively with any whitespace and normalizes them to lowercase", () => {
    expect(normalizeEventMonitorSqlCommand("SHOW  Event-Monitor   SQLITE  SELECT 1")).toBe(`${SQLITE_PREFIX} SELECT 1`);
    expect(normalizeEventMonitorSqlCommand("show\tevent-monitor sqlite select 1")).toBe(`${SQLITE_PREFIX} select 1`);
  });

  it.each([
    "attach database '/mnt/flash/x.db' as p",
    "vacuum into '/mnt/flash/x.db'",
    "pragma database_list",
    "delete from route",
    "selectx from t",
    "select 1; select 2",
    "select 1; attach database 'x' as p",
    "select 1;;",
    "select 1 | tee flash:x",
    "select 1 | include 1",
    "select 1 ||| 2",
    "select 1 > flash:x",
    "select 1 >> flash:x",
    "select 1 >flash:x",
    "select 1 > file:/tmp/x",
    "select $x",
    "select 1 & 2",
    "select `x`",
    "select 1\nselect 2",
    "select 1\u0000",
    "select 1\u007f",
    "",
    "   ;"
  ])("rejects %j", (statement) => {
    expect(() => normalizeEventMonitorSqlStatement(statement)).toThrow(sqlRejection);
    expect(() => normalizeEventMonitorSqlCommand(`${SQLITE_PREFIX} ${statement}`)).toThrow(sqlRejection);
  });

  it.each(["show event-monitor sqlite", "show event-monitor sqlite   ;"])("rejects the empty statement in %j", (command) => {
    expect(() => normalizeEventMonitorSqlCommand(command)).toThrow(sqlRejection);
  });

  it.each([
    ["attach x; select 1", "statement must not contain ';' other than one trailing ';'"],
    ["select 1\n;", "statement must be a single line without control characters"],
    ["   ;", "statement must not be empty"],
    ["attach database 'x' as p", "statement must start with SELECT or WITH"],
    ["select 1 | include 1", "statement must not contain a single '|' (only '||' concatenation is allowed)"]
  ])("rejects %j with a stable reason", (statement, reason) => {
    expect(() => normalizeEventMonitorSqlStatement(statement)).toThrow(
      expect.objectContaining({ message: `Event monitor SQL rejected: ${reason}; only one read-only SELECT or WITH statement is allowed` })
    );
  });

  it.each(["sq", "sqli", "SQLite", "s", "SQ"])("guards the abbreviated %j keyword", (keyword) => {
    for (const statement of ["attach database '/mnt/flash/x.db' as p", "vacuum into '/mnt/flash/x.db'"]) {
      expect(() => normalizeEventMonitorSqlCommand(`show event-monitor ${keyword} ${statement}`)).toThrow(sqlRejection);
    }
    expect(() => normalizeEventMonitorSqlCommand(`show event-monitor ${keyword}`)).toThrow(sqlRejection);
  });

  it("normalizes an abbreviated keyword to the full sqlite keyword", () => {
    expect(normalizeEventMonitorSqlCommand("show event-monitor sq select 1")).toBe(`${SQLITE_PREFIX} select 1`);
    expect(normalizeEventMonitorSqlCommand("SHOW event-monitor  Sqli\tselect 1;")).toBe(`${SQLITE_PREFIX} select 1`);
  });

  it("leaves other commands to the generic metacharacter check", () => {
    for (const command of ["show event-monitor route limit 2 | tee flash:x", "show event-monitor sqlitex select 1; x", "show event-monitor sqlx select 1", "show event-monitor sq-x select 1", "show event-monitor route", "show version"]) {
      expect(normalizeEventMonitorSqlCommand(command)).toBeUndefined();
    }
    expect(() => normalizeShowCommand("show event-monitor route limit 2 | tee flash:x")).toThrow(expect.objectContaining({ code: "eos_input_invalid" }));
    expect(() => normalizeShowCommand("show event-monitor sqlitex select 1; x")).toThrow(expect.objectContaining({ code: "eos_input_invalid" }));
  });
});
