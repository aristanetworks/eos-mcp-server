import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { buildValidateInventoryResult } from "../src/commands/validateInventory.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("buildValidateInventoryResult", () => {
  it("uses one inventory snapshot for the report and startup connection checks", async () => {
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_network_os: eos",
      "    ansible_user: admin",
      "    ansible_password: secret"
    ]);
    const original = await fs.readFile(inventoryPath, "utf8");
    // A second read would see a different host with missing connection credentials.
    const readFile = vi.spyOn(fs, "readFile")
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce("hosts:\n  leaf2:\n    ansible_network_os: eos\n");
    try {
      const result = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: false });

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.hosts).toEqual([expect.objectContaining({ inventory_hostname: "leaf1" })]);
      expect(result).not.toHaveProperty("model");
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(readFile).toHaveBeenCalledExactlyOnceWith(inventoryPath, "utf8");
    } finally {
      readFile.mockRestore();
    }
  });

  it("returns structural errors before startup connection checks", async () => {
    const inventoryPath = await writeTempInventory(["hosts: []"]);

    const result = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: false });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "inventory_hosts_invalid" })]));
    expect(result.notes).toContain("Effective validation stopped before startup connection checks due to inventory errors.");
    expect(result).not.toHaveProperty("model");
  });
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

  it("reports read, diagnostic and packet capture permission per host", async () => {
    const inventoryPath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "  mcp_diagnostics_allowed: true",
      "hosts:",
      "  leaf1:",
      "    mcp_packet_capture_allowed: true",
      "  leaf2:",
      "    mcp_read_allowed: false",
      "    mcp_packet_capture_allowed: true"
    ]);

    const result = await buildValidateInventoryResult(buildConfig({ inventoryPath }), { inventoryOnly: true });

    expect(result.hosts).toEqual([
      expect.objectContaining({
        inventory_hostname: "leaf1", read_allowed: true, diagnostics_allowed: true, packet_capture_allowed: true
      }),
      expect.objectContaining({
        inventory_hostname: "leaf2", read_allowed: false, diagnostics_allowed: false, packet_capture_allowed: false
      })
    ]);
  });
});
