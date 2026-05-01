import { describe, expect, it } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildListInventoryToolResult } from "../src/mcp/tools/listInventory.js";
import { writeTempInventory } from "./helpers.js";

describe("buildListInventoryToolResult", () => {
  it("returns only eligible hosts by default", async () => {
    const inventoryPath = await writeTempInventory([
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

    const model = await loadInventoryModel(inventoryPath);
    const result = buildListInventoryToolResult(model, {});
    const payload = result.structuredContent as {
      hosts: Array<{ inventory_hostname: string }>;
    };

    expect(payload.hosts.map((host) => host.inventory_hostname)).toEqual(["leaf1"]);
  });

  it("can include ineligible hosts when requested", async () => {
    const inventoryPath = await writeTempInventory([
      "hosts:",
      "  linux1:",
      "    ansible_host: 10.0.0.21"
    ]);

    const model = await loadInventoryModel(inventoryPath);
    const result = buildListInventoryToolResult(model, { include_ineligible: true });
    const payload = result.structuredContent as {
      hosts: Array<{ inventory_hostname: string; eligible: boolean }>;
    };

    expect(payload.hosts).toHaveLength(1);
    expect(payload.hosts[0]?.inventory_hostname).toBe("linux1");
    expect(payload.hosts[0]?.eligible).toBe(false);
  });
});
