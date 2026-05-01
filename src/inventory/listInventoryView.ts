import type { InventoryModel } from "./types.js";

export interface ListInventoryView {
  hosts: Array<{
    inventory_hostname: string;
    resolved_endpoint: string;
    eligible: boolean;
    read_allowed: boolean;
    write_allowed: boolean;
    ineligibility_reasons: string[];
    group_memberships: string[];
  }>;
  groups: Array<{
    name: string;
    actionable: boolean;
    eligible_host_count: number;
    ineligible_host_count: number;
    resolved_hosts: string[];
    children: string[];
  }>;
}

export interface BuildListInventoryViewOptions {
  includeIneligible: boolean;
}

export function buildListInventoryView(
  model: InventoryModel,
  options: BuildListInventoryViewOptions
): ListInventoryView {
  const hosts = model.hosts
    .filter((host) => options.includeIneligible || host.eligible)
    .map((host) => ({
      inventory_hostname: host.inventoryHostname,
      resolved_endpoint: host.resolvedEndpoint,
      eligible: host.eligible,
      read_allowed: host.readAllowed,
      write_allowed: host.writeAllowed,
      ineligibility_reasons: [...host.ineligibilityReasons],
      group_memberships: [...host.groupMemberships]
    }));

  const groups = model.groups.map((group) => ({
    name: group.name,
    actionable: group.actionable,
    eligible_host_count: group.eligibleHostCount,
    ineligible_host_count: group.ineligibleHostCount,
    resolved_hosts: [...group.resolvedHosts],
    children: [...group.children]
  }));

  return { hosts, groups };
}
