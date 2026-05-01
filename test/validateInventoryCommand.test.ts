import { describe, expect, it } from "vitest";
import { buildValidateInventoryResult } from "../src/commands/validateInventory.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("buildValidateInventoryResult", () => {
  it("inventory-only mode skips startup connection validation", async () => {
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const result = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: true });

    expect(result.ok).toBe(true);
    expect(result.notes).toContain("Inventory-only mode skips startup connection validation.");
  });

  it("effective mode includes startup connection validation", async () => {
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const result = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: false });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "connection_username_missing")).toBe(true);
    expect(result.notes).toContain("Effective validation included startup connection checks for EOS-eligible hosts.");
  });

  it("effective mode passes when startup connection requirements are satisfied", async () => {
    setTestPasswordEnv();
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos"
    ]);

    const result = await buildValidateInventoryResult(
      buildConfig({
        inventoryPath,
        defaultConnection: {
          ansibleUser: "admin",
          mcpPasswordEnv: "EOS_MCP_PASSWORD"
        }
      }),
      { inventoryOnly: false }
    );

    expect(result.ok).toBe(true);
    expect(result.notes).toContain("Effective validation included startup connection checks for EOS-eligible hosts.");
  });
});
