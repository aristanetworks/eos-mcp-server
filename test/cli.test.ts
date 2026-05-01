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
});
