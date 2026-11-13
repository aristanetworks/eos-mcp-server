import { describe, expect, it } from "vitest";
import { isPrivilegedShowCommand, PRIVILEGED_SHOW_COMMANDS } from "../src/show/privilegedShow.js";

describe("isPrivilegedShowCommand", () => {
  const builtInCommands = PRIVILEGED_SHOW_COMMANDS;

  it.each([
    "show event-monitor",
    "show event-monitor route limit 5",
    "SHOW Event-Monitor mac match-mac 001c.%",
    "  show   event-monitor   status  ",
    "show event-monitor sqlite select * from route"
  ])("matches %j", (command) => {
    expect(isPrivilegedShowCommand(command, builtInCommands)).toBe(true);
  });

  it.each([
    "show version",
    "show running-config",
    "sh event-monitor route",
    "show ev route",
    "show event-monitors route",
    "show event-monitor-x",
    "show",
    ""
  ])("does not match %j", (command) => {
    expect(isPrivilegedShowCommand(command, builtInCommands)).toBe(false);
  });

  it("matches nothing when operators narrow the list to empty", () => {
    expect(isPrivilegedShowCommand("show event-monitor route", [])).toBe(false);
  });
});
