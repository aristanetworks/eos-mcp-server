import { describe, expect, it } from "vitest";
import { loadInventoryModel, loadInventorySummary, validateInventory } from "../src/inventory/loadInventory.js";
import { writeTempInventory } from "./helpers.js";

describe("inventory validation", () => {
  it("computes eligibility and read-policy counts from simplified inventory inheritance", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_user: admin",
      "  ansible_network_os: eos",
      "groups:",
      "  leafs:",
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

  it("rejects non-boolean read policy values instead of defaulting open", async () => {
    const filePath = await writeTempInventory([
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "    mcp_read_allowed: \"false\""
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "inventory_var_type_invalid",
          path: "hosts.leaf1.mcp_read_allowed"
        })
      ])
    );
  });

  it("rejects invalid known connection and platform variable types", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: true",
      "  mcp_validate_certs: \"false\"",
      "groups:",
      "  leafs:",
      "    vars:",
      "      ansible_httpapi_validate_certs: \"false\"",
      "    hosts: [leaf1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_httpapi_port: bad-port",
      "    mcp_password_env: \"\""
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "inventory_var_type_invalid", path: "vars.ansible_network_os" }),
        expect.objectContaining({ code: "inventory_var_type_invalid", path: "vars.mcp_validate_certs" }),
        expect.objectContaining({ code: "inventory_var_type_invalid", path: "groups.leafs.vars.ansible_httpapi_validate_certs" }),
        expect.objectContaining({ code: "inventory_var_type_invalid", path: "hosts.leaf1.ansible_httpapi_port" }),
        expect.objectContaining({ code: "inventory_var_type_invalid", path: "hosts.leaf1.mcp_password_env" })
      ])
    );
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

  it("preserves hosts when a canonical group is referenced under multiple parents with null body", async () => {
    process.env.EOS_MCP_PASSWORD = "secret";
    const filePath = await writeTempInventory([
      "all:",
      "  vars:",
      "    ansible_user: admin",
      "    ansible_network_os: eos",
      "    mcp_password_env: EOS_MCP_PASSWORD",
      "  children:",
      "    FABRIC:",
      "      children:",
      "        DC1:",
      "          children:",
      "            DC1_LEAFS:",
      "              hosts:",
      "                leaf1:",
      "                  ansible_host: 10.0.0.1",
      "                leaf2:",
      "                  ansible_host: 10.0.0.2",
      "    NETWORK_SERVICES:",
      "      children:",
      "        DC1_LEAFS:"
    ]);

    const model = await loadInventoryModel(filePath);
    const leafGroup = model.groupMap.get("DC1_LEAFS");
    expect(leafGroup).toBeDefined();
    expect(leafGroup!.hosts).toContain("leaf1");
    expect(leafGroup!.hosts).toContain("leaf2");
    expect(leafGroup!.resolvedHosts).toContain("leaf1");
    expect(leafGroup!.resolvedHosts).toContain("leaf2");
    expect(leafGroup!.eligibleHostCount).toBe(2);

    const networkServicesGroup = model.groupMap.get("NETWORK_SERVICES");
    expect(networkServicesGroup).toBeDefined();
    expect(networkServicesGroup!.children).toContain("DC1_LEAFS");
    expect(networkServicesGroup!.resolvedHosts).toContain("leaf1");
    expect(networkServicesGroup!.resolvedHosts).toContain("leaf2");

    const leaf1 = model.hostMap.get("leaf1");
    expect(leaf1).toBeDefined();
    expect(leaf1!.eligible).toBe(true);
    expect(leaf1!.groupMemberships).toContain("DC1_LEAFS");
    expect(leaf1!.groupMemberships).toContain("DC1");
    expect(leaf1!.groupMemberships).toContain("FABRIC");
    expect(leaf1!.groupMemberships).toContain("NETWORK_SERVICES");
    delete process.env.EOS_MCP_PASSWORD;
  });

  it("accepts canonical hosts with null bodies as empty host vars", async () => {
    process.env.EOS_MCP_PASSWORD = "secret";
    const filePath = await writeTempInventory([
      "all:",
      "  vars:",
      "    ansible_user: admin",
      "    ansible_network_os: eos",
      "    mcp_password_env: EOS_MCP_PASSWORD",
      "  children:",
      "    leafs:",
      "      hosts:",
      "        leaf1:",
      "        leaf2:"
    ]);

    const model = await loadInventoryModel(filePath);
    expect(model.hosts.map((host) => host.inventoryHostname)).toEqual(["leaf1", "leaf2"]);
    expect(model.hostMap.get("leaf1")?.effectiveVars.ansible_user).toBe("admin");
    expect(model.groupMap.get("leafs")?.resolvedHosts).toEqual(["leaf1", "leaf2"]);
    delete process.env.EOS_MCP_PASSWORD;
  });

  it("rejects unknown top-level keys in canonical inventory", async () => {
    const filePath = await writeTempInventory([
      "all:",
      "  vars:",
      "    ansible_network_os: eos",
      "unexpected:",
      "  hosts: {}"
    ]);

    const result = await validateInventory(filePath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("unexpected"))).toBe(true);
  });

  it("merges hosts when a canonical group is defined in two places with hosts", async () => {
    process.env.EOS_MCP_PASSWORD = "secret";
    const filePath = await writeTempInventory([
      "all:",
      "  vars:",
      "    ansible_user: admin",
      "    ansible_network_os: eos",
      "    mcp_password_env: EOS_MCP_PASSWORD",
      "  children:",
      "    PARENT_A:",
      "      children:",
      "        SHARED_GROUP:",
      "          hosts:",
      "            host1:",
      "              ansible_host: 10.0.0.1",
      "    PARENT_B:",
      "      children:",
      "        SHARED_GROUP:",
      "          hosts:",
      "            host2:",
      "              ansible_host: 10.0.0.2"
    ]);

    const model = await loadInventoryModel(filePath);
    const sharedGroup = model.groupMap.get("SHARED_GROUP");
    expect(sharedGroup).toBeDefined();
    expect(sharedGroup!.hosts.sort()).toEqual(["host1", "host2"]);
    expect(sharedGroup!.resolvedHosts.sort()).toEqual(["host1", "host2"]);
    delete process.env.EOS_MCP_PASSWORD;
  });

  it("merges vars when a canonical group appears multiple times", async () => {
    process.env.EOS_MCP_PASSWORD = "secret";
    const filePath = await writeTempInventory([
      "all:",
      "  vars:",
      "    ansible_user: admin",
      "    ansible_network_os: eos",
      "    mcp_password_env: EOS_MCP_PASSWORD",
      "  children:",
      "    PARENT_A:",
      "      children:",
      "        SHARED_GROUP:",
      "          vars:",
      "            custom_var: from_a",
      "            shared_var: original",
      "          hosts:",
      "            host1:",
      "              ansible_host: 10.0.0.1",
      "    PARENT_B:",
      "      children:",
      "        SHARED_GROUP:",
      "          vars:",
      "            shared_var: overridden",
      "            another_var: from_b"
    ]);

    const model = await loadInventoryModel(filePath);
    const host1 = model.hostMap.get("host1");
    expect(host1).toBeDefined();
    expect(host1!.effectiveVars.custom_var).toBe("from_a");
    expect(host1!.effectiveVars.shared_var).toBe("overridden");
    expect(host1!.effectiveVars.another_var).toBe("from_b");
    delete process.env.EOS_MCP_PASSWORD;
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
