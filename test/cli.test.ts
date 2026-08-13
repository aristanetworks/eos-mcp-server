import { describe, expect, it, vi } from "vitest";
import { parseCliArgs, printHelp } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("parses local probe command arguments", () => {
    expect(parseCliArgs(["probe", "--inventory", "inventory.yml", "--target", "leafs", "--json"])).toMatchObject({
      command: "probe",
      inventoryPath: "inventory.yml",
      target: "leafs",
      json: true
    });
  });

  it("sets help when --help is the first argument", () => {
    const result = parseCliArgs(["--help"]);
    expect(result.help).toBe(true);
    expect(result.command).toBe("serve");
    expect(result.explicitCommand).toBeUndefined();
  });

  it("sets help when -h is the first argument", () => {
    const result = parseCliArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  it("sets help for a specific subcommand", () => {
    const result = parseCliArgs(["serve", "--help"]);
    expect(result.help).toBe(true);
    expect(result.command).toBe("serve");
    expect(result.explicitCommand).toBe(true);
  });

  it("sets help for validate-inventory subcommand", () => {
    const result = parseCliArgs(["validate-inventory", "--help"]);
    expect(result.help).toBe(true);
    expect(result.command).toBe("validate-inventory");
    expect(result.explicitCommand).toBe(true);
  });

  it("stops parsing remaining args after --help", () => {
    const result = parseCliArgs(["probe", "--inventory", "inv.yml", "--help", "--target", "leaf1"]);
    expect(result.help).toBe(true);
    expect(result.inventoryPath).toBe("inv.yml");
    expect(result.target).toBeUndefined();
  });

  it("tracks explicitCommand for subcommands", () => {
    const result = parseCliArgs(["probe", "--target", "leaf1"]);
    expect(result.explicitCommand).toBe(true);
  });

  it("does not set explicitCommand when defaulting to serve", () => {
    const result = parseCliArgs(["--inventory", "inv.yml"]);
    expect(result.explicitCommand).toBeUndefined();
    expect(result.command).toBe("serve");
  });

  it("sets version when --version is the first argument", () => {
    const result = parseCliArgs(["--version"]);
    expect(result.version).toBe(true);
    expect(result.command).toBe("serve");
  });

  it("sets version when -V is the first argument", () => {
    const result = parseCliArgs(["-V"]);
    expect(result.version).toBe(true);
  });

  it("sets version when --version appears after a subcommand", () => {
    const result = parseCliArgs(["probe", "--version"]);
    expect(result.version).toBe(true);
    expect(result.command).toBe("probe");
    expect(result.explicitCommand).toBe(true);
  });

  it("keeps serve-only and reserved flags out of top-level public help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output = "";

    try {
      printHelp(parseCliArgs(["--help"]));
      output = log.mock.calls.map((call) => call.join(" ")).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(output).not.toContain("--actor");
  });

  it("advertises actor only in serve help", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let serveOutput = "";
    let printServerInfoOutput = "";

    try {
      printHelp(parseCliArgs(["serve", "--help"]));
      printHelp(parseCliArgs(["print-server-info", "--help"]));
      serveOutput = log.mock.calls[0]?.join(" ") ?? "";
      printServerInfoOutput = log.mock.calls[1]?.join(" ") ?? "";
    } finally {
      log.mockRestore();
    }

    expect(serveOutput).toContain("--actor");
    expect(printServerInfoOutput).not.toContain("--actor");
  });

  it.each([
    [["serve", "--json"], "Option --json is not valid for command serve"],
    [["validate-inventory", "--target", "leaf1"], "Option --target is not valid for command validate-inventory"],
    [["probe", "--inventory-only"], "Option --inventory-only is not valid for command probe"],
    [["print-server-info", "--target", "leaf1"], "Option --target is not valid for command print-server-info"],
    [["print-server-info", "--actor", "ci"], "Option --actor is not valid for command print-server-info"]
  ])("rejects command-specific invalid options: %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
