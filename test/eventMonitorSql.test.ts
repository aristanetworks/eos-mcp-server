import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors.js";
import { normalizeEventMonitorSqlStatement, normalizeShowCommand } from "../src/eapi/commands.js";

const SQLITE_PREFIX = "show event-monitor sqlite";

function expectRejected(action: () => unknown, expectedCode: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(expectedCode);
    return;
  }
  throw new Error("expected action to throw");
}

describe("event monitor SQL guard", () => {
  const acceptedStatements = [
    "select * from route limit 3",
    "SELECT count(*) FROM arp",
    "with recent as (select counter from route) select max(counter) from recent",
    "select counter from route where counter > 97",
    "select 'a' || 'b'",
    "select x from t where a <> b and c < 2",
    "select a from t where a >= b"
  ];

  for (const statement of acceptedStatements) {
    it(`accepts: ${statement}`, () => {
      expect(normalizeEventMonitorSqlStatement(statement)).toBe(statement);
      expect(normalizeShowCommand(`${SQLITE_PREFIX} ${statement}`)).toBe(`${SQLITE_PREFIX} ${statement}`);
    });
  }

  it("strips exactly one trailing semicolon and surrounding whitespace", () => {
    expect(normalizeEventMonitorSqlStatement("select 1;")).toBe("select 1");
    expect(normalizeEventMonitorSqlStatement("select 1 ;  ")).toBe("select 1");
    expect(normalizeShowCommand(`${SQLITE_PREFIX} select 1;`)).toBe(`${SQLITE_PREFIX} select 1`);
  });

  it("matches the keywords case-insensitively with any whitespace and normalizes them to lowercase", () => {
    expect(normalizeShowCommand("SHOW  Event-Monitor   SQLITE  SELECT 1")).toBe(`${SQLITE_PREFIX} SELECT 1`);
    expect(normalizeShowCommand("show\tevent-monitor sqlite select 1")).toBe(`${SQLITE_PREFIX} select 1`);
  });

  const rejectedStatements = [
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
  ];

  for (const statement of rejectedStatements) {
    it(`rejects: ${JSON.stringify(statement)}`, () => {
      expectRejected(() => normalizeEventMonitorSqlStatement(statement), "event_monitor_sqlite_rejected");
      expectRejected(() => normalizeShowCommand(`${SQLITE_PREFIX} ${statement}`), "event_monitor_sqlite_rejected");
    });
  }

  it("rejects empty statements given as whole commands", () => {
    expectRejected(() => normalizeShowCommand("show event-monitor sqlite"), "event_monitor_sqlite_rejected");
    expectRejected(() => normalizeShowCommand("show event-monitor sqlite   ;"), "event_monitor_sqlite_rejected");
  });

  it("mentions the read-only restriction in the message", () => {
    try {
      normalizeEventMonitorSqlStatement("delete from route");
    } catch (error) {
      expect((error as AppError).message).toMatch(/only one read-only SELECT or WITH statement/);
      return;
    }
    throw new Error("expected throw");
  });

  it("keeps the existing metacharacter check for other commands", () => {
    expectRejected(() => normalizeShowCommand("show event-monitor route limit 2 | tee flash:x"), "eos_input_invalid");
    expectRejected(() => normalizeShowCommand("show event-monitor sqlitex select 1; x"), "eos_input_invalid");
    expect(normalizeShowCommand("show version")).toBe("show version");
  });
});
