import { describe, expect, it } from "vitest";
import { buildLoggingQuery } from "../src/logging/loggingQuery.js";

describe("buildLoggingQuery", () => {
  it("defaults to warning-level logs and 100 messages", () => {
    expect(buildLoggingQuery({}, { maxMessageCount: 1000 })).toEqual({
      minimumSeverity: "warnings",
      messageCount: 100,
      command: "show logging threshold warnings 100"
    });
  });

  it("builds a bounded EOS logging command from explicit inputs", () => {
    expect(
      buildLoggingQuery(
        {
          minimumSeverity: "errors",
          messageCount: 50
        },
        { maxMessageCount: 1000 }
      )
    ).toEqual({
      minimumSeverity: "errors",
      messageCount: 50,
      command: "show logging threshold errors 50"
    });
  });

  it("rejects unsupported severities", () => {
    expect(() =>
      buildLoggingQuery(
        {
          minimumSeverity: "warning"
        },
        { maxMessageCount: 1000 }
      )
    ).toThrow(expect.objectContaining({ code: "logging_severity_invalid" }));
  });

  it("rejects invalid EOS message counts", () => {
    expect(() =>
      buildLoggingQuery(
        {
          messageCount: 10_000
        },
        { maxMessageCount: 10_000 }
      )
    ).toThrow(expect.objectContaining({ code: "logging_message_count_invalid" }));
  });

  it("rejects message counts above the configured logging limit", () => {
    expect(() =>
      buildLoggingQuery(
        {
          messageCount: 26
        },
        { maxMessageCount: 25 }
      )
    ).toThrow(expect.objectContaining({ code: "logging_message_count_limit_exceeded" }));
  });
});
