import { describe, expect, it } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { resolveInventoryTarget } from "../src/inventory/resolveTarget.js";
import { buildListInventoryView } from "../src/inventory/listInventoryView.js";
import { writeTempInventory } from "./helpers.js";

describe("target resolution and inventory listing", () => {
  it("resolves a group target with deduplication and alphabetical ordering", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "groups:",
      "  leafs:",
      "    hosts: [leaf2, leaf1]",
      "  dc1:",
      "    hosts: [leaf1]",
      "    children: [leafs]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "  leaf2:",
      "    ansible_host: 10.0.0.12"
    ]);

    const model = await loadInventoryModel(filePath);
    const result = resolveInventoryTarget(model, {
      target: "dc1",
      operationKind: "read"
    });

    expect(result.resolvedHosts.map((host) => host.inventoryHostname)).toEqual(["leaf1", "leaf2"]);
  });

  it("fails closed for write targets containing policy-denied hosts", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "groups:",
      "  writable:",
      "    vars:",
      "      mcp_write_allowed: true",
      "    hosts: [leaf1]",
      "  mixed:",
      "    children: [writable]",
      "    hosts: [leaf2]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "  leaf2:",
      "    ansible_host: 10.0.0.12"
    ]);

    const model = await loadInventoryModel(filePath);

    expect(() =>
      resolveInventoryTarget(model, {
        target: "mixed",
        operationKind: "write"
      })
    ).toThrow(/policy/i);
  });

  it("rejects write targeting of the special all group", async () => {
    const filePath = await writeTempInventory([
      "vars:",
      "  ansible_network_os: eos",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11"
    ]);

    const model = await loadInventoryModel(filePath);

    expect(() =>
      resolveInventoryTarget(model, {
        target: "all",
        operationKind: "write"
      })
    ).toThrow(/all/i);
  });

  it("builds a default inventory view with only eligible hosts but all groups", async () => {
    const filePath = await writeTempInventory([
      "groups:",
      "  leafs:",
      "    hosts: [leaf1]",
      "  linux_hosts:",
      "    hosts: [linux1]",
      "hosts:",
      "  leaf1:",
      "    ansible_host: 10.0.0.11",
      "    ansible_network_os: eos",
      "  linux1:",
      "    ansible_host: 10.0.0.21"
    ]);

    const model = await loadInventoryModel(filePath);
    const view = buildListInventoryView(model, { includeIneligible: false });

    expect(view.hosts.map((host) => host.inventory_hostname)).toEqual(["leaf1"]);
    expect(view.groups.find((group) => group.name === "linux_hosts")?.actionable).toBe(false);
    expect(view.groups.find((group) => group.name === "leafs")?.eligible_host_count).toBe(1);
  });

  it("can include ineligible hosts with reasons in inventory view", async () => {
    const filePath = await writeTempInventory([
      "groups:",
      "  linux_hosts:",
      "    hosts: [linux1]",
      "hosts:",
      "  linux1:",
      "    ansible_host: 10.0.0.21"
    ]);

    const model = await loadInventoryModel(filePath);
    const view = buildListInventoryView(model, { includeIneligible: true });

    expect(view.hosts).toHaveLength(1);
    expect(view.hosts[0]?.eligible).toBe(false);
    expect(view.hosts[0]?.ineligibility_reasons.length).toBeGreaterThan(0);
  });
});
