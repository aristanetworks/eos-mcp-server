import { describe, expect, it } from "vitest";
import { loadInventorySummary, validateInventory } from "../src/inventory/loadInventory.js";
import { writeTempInventory } from "./helpers.js";

describe("inventory validation", () => {
  it("computes eligibility and policy counts from simplified inventory inheritance", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_user: admin",
      "  ansible_network_os: eos",
      "groups:",
      "  writable_leafs:",
      "    vars:",
      "      mcp_write_allowed: true",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11"
    ]);

    const summary = await loadInventorySummary(filePath);
    expect(summary.schemaKind).toBe("simplified-yaml");
    expect(summary.totalHostCount).toBe(1);
    expect(summary.totalGroupCount).toBe(2);
    expect(summary.eosEligibleHostCount).toBe(1);
    expect(summary.readAllowedHostCount).toBe(1);
    expect(summary.writeAllowedHostCount).toBe(1);
  });

  it("rejects simplified inventory group cycles", async () => {
    const filePath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "groups:",
      "  dc1:",
      "    children: [leafs]",
      "  leafs:",
      "    children: [dc1]",
      "    hosts: [leaf1]"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("cycle"))).toBe(true);
  });

  it("rejects unknown group host references in simplified inventory", async () => {
    const filePath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "groups:",
      "  leafs:",
      "    hosts: [leaf1, leaf2]"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("leaf2"))).toBe(true);
  });

  it("rejects contradictory deny-dominant write policy", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "  mcp_write_allowed: false",
      "groups:",
      "  lab:",
      "    vars:",
      "      mcp_write_allowed: true",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("mcp_write_allowed"))).toBe(true);
  });

  it("rejects unknown structural keys in simplified groups", async () => {
    const filePath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "groups:",
      "  leafs:",
      "    badkey: true",
      "    hosts: [leaf1]"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("badkey"))).toBe(true);
  });

  it("rejects conflicting platform declarations", async () => {
    const filePath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "    mcp_platform: cisco_ios"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "inventory_platform_conflict")).toBe(true);
  });
});
