import path from "node:path";
import { evaluateHostAccess, evaluateHostEligibility } from "./policy.js";
import type { InventoryGroupModel, InventoryHostModel, InventoryModel, InventorySummary } from "./types.js";
import type { NormalizedInventory, ValidationContext } from "./internalTypes.js";
import { resolveEffectiveHostVars } from "./effectiveVars.js";
import {
  buildDirectMemberships,
  buildGroupDepths,
  buildParentGroupMap,
  collectLineageGroups,
  resolveGroupHosts
} from "./graph.js";

export function buildInventoryModel(
  inventory: NormalizedInventory,
  inventoryPath: string,
  context: ValidationContext
): InventoryModel | null {
  const parentGroups = buildParentGroupMap(inventory);
  const groupDepths = buildGroupDepths(inventory, parentGroups);
  const directMemberships = buildDirectMemberships(inventory);
  const hostModels = new Map<string, InventoryHostModel>();

  for (const [hostName, hostVars] of inventory.hosts.entries()) {
    const lineageGroups = collectLineageGroups(hostName, parentGroups, directMemberships);
    const effectiveVars = resolveEffectiveHostVars(hostName, hostVars, inventory, lineageGroups, groupDepths, context);

    const eligibility = evaluateHostEligibility(hostName, effectiveVars);
    context.errors.push(...eligibility.errors);
    const access = evaluateHostAccess(eligibility.eligible, effectiveVars);
    const resolvedEndpoint = typeof effectiveVars.ansible_host === "string" ? effectiveVars.ansible_host : hostName;

    hostModels.set(hostName, {
      inventoryHostname: hostName,
      resolvedEndpoint,
      effectiveVars,
      eligible: eligibility.eligible,
      readAllowed: access.readAllowed,
      ineligibilityReasons: eligibility.ineligibilityReasons,
      groupMemberships: [...lineageGroups].sort()
    });
  }

  if (context.errors.length > 0) {
    return null;
  }

  const groupResolutionMemo = new Map<string, string[]>();
  const groupModels = new Map<string, InventoryGroupModel>();

  for (const [groupName, group] of inventory.groups.entries()) {
    const resolvedHosts = resolveGroupHosts(groupName, inventory, groupResolutionMemo);
    const eligibleHostCount = resolvedHosts.filter((hostName) => hostModels.get(hostName)?.eligible === true).length;
    const ineligibleHostCount = resolvedHosts.length - eligibleHostCount;

    groupModels.set(groupName, {
      name: groupName,
      hosts: [...group.hosts].sort(),
      children: [...group.children].sort(),
      resolvedHosts,
      eligibleHostCount,
      ineligibleHostCount,
      actionable: eligibleHostCount > 0
    });
  }

  const allResolvedHosts = [...inventory.hosts.keys()].sort();
  const allEligibleHostCount = allResolvedHosts.filter((hostName) => hostModels.get(hostName)?.eligible === true).length;
  groupModels.set("all", {
    name: "all",
    hosts: [],
    children: [...inventory.groups.keys()].sort(),
    resolvedHosts: allResolvedHosts,
    eligibleHostCount: allEligibleHostCount,
    ineligibleHostCount: allResolvedHosts.length - allEligibleHostCount,
    actionable: allEligibleHostCount > 0
  });

  const hosts = [...hostModels.values()].sort((left, right) => left.inventoryHostname.localeCompare(right.inventoryHostname));
  const groups = [...groupModels.values()].sort((left, right) => left.name.localeCompare(right.name));

  const summary: InventorySummary = {
    path: inventoryPath,
    basename: path.basename(inventoryPath),
    schemaKind: inventory.schemaKind,
    totalHostCount: hosts.length,
    totalGroupCount: groups.length,
    eosEligibleHostCount: hosts.filter((host) => host.eligible).length,
    readAllowedHostCount: hosts.filter((host) => host.readAllowed).length
  };

  return {
    path: inventoryPath,
    basename: path.basename(inventoryPath),
    schemaKind: inventory.schemaKind,
    summary,
    hosts,
    groups,
    hostMap: new Map(hosts.map((host) => [host.inventoryHostname, host])),
    groupMap: new Map(groups.map((group) => [group.name, group]))
  };
}
