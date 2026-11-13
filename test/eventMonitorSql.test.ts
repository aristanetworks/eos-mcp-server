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

  it("leaves other commands to the generic metacharacter check", () => {
    for (const command of ["show event-monitor route limit 2 | tee flash:x", "show event-monitor sqlitex select 1; x", "show version"]) {
      expect(normalizeEventMonitorSqlCommand(command)).toBeUndefined();
    }
    expect(() => normalizeShowCommand("show event-monitor route limit 2 | tee flash:x")).toThrow(expect.objectContaining({ code: "eos_input_invalid" }));
    expect(() => normalizeShowCommand("show event-monitor sqlitex select 1; x")).toThrow(expect.objectContaining({ code: "eos_input_invalid" }));
  });
});
