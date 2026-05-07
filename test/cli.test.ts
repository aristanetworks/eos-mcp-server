import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli.js";

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
});
