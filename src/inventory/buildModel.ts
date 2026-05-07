import path from "node:path";
import { evaluateHostAccess, evaluateHostEligibility } from "./policy.js";
import type { InventoryGroupModel, InventoryHostModel, InventoryModel, InventorySummary } from "./types.js";
import type { InventoryVars, NormalizedInventory, ValidationContext } from "./internalTypes.js";
import { readBoolean } from "../utils/value.js";
import { stableValueKey } from "./internalUtils.js";

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
      writeAllowed: access.writeAllowed,
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
    readAllowedHostCount: hosts.filter((host) => host.readAllowed).length,
    writeAllowedHostCount: hosts.filter((host) => host.writeAllowed).length
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

function resolveGroupHosts(
  groupName: string,
  inventory: NormalizedInventory,
  memo: Map<string, string[]>
): string[] {
  const existing = memo.get(groupName);
  if (existing) {
    return existing;
  }

  const group = inventory.groups.get(groupName);
  if (!group) {
    return [];
  }

  const hostNames = new Set<string>(group.hosts);
  for (const child of group.children) {
    for (const childHost of resolveGroupHosts(child, inventory, memo)) {
      hostNames.add(childHost);
    }
  }

  const resolved = [...hostNames].sort();
  memo.set(groupName, resolved);
  return resolved;
}

function resolveEffectiveHostVars(
  hostName: string,
  hostVars: InventoryVars,
  inventory: NormalizedInventory,
  lineageGroups: Set<string>,
  groupDepths: Map<string, number>,
  context: ValidationContext
): InventoryVars {
  const effectiveVars: InventoryVars = { ...inventory.globalVars };
  const groupedValues = new Map<string, Map<number, Set<string>>>();

  for (const groupName of lineageGroups) {
    const group = inventory.groups.get(groupName);
    if (!group) {
      continue;
    }

    const depth = groupDepths.get(groupName) ?? 1;
    for (const [key, value] of Object.entries(group.vars)) {
      const byDepth = groupedValues.get(key) ?? new Map<number, Set<string>>();
      const valuesAtDepth = byDepth.get(depth) ?? new Set<string>();
      valuesAtDepth.add(stableValueKey(value));
      byDepth.set(depth, valuesAtDepth);
      groupedValues.set(key, byDepth);
    }
  }

  for (const [key, byDepth] of groupedValues.entries()) {
    for (const [depth, valuesAtDepth] of byDepth.entries()) {
      if (valuesAtDepth.size > 1) {
        context.errors.push({
          code: "inventory_same_level_conflict",
          message: `Host ${hostName} inherits conflicting values for ${key} at group depth ${depth}`,
          path: hostName
        });
      }
    }

    const winningDepth = Math.max(...byDepth.keys());
    const groupValue = findGroupValueAtDepth(key, winningDepth, lineageGroups, inventory, groupDepths);
    if (groupValue !== undefined) {
      effectiveVars[key] = groupValue;
    }
  }

  for (const [key, value] of Object.entries(hostVars)) {
    effectiveVars[key] = value;
  }

  validateWritePolicyContradictions(hostName, inventory.globalVars, lineageGroups, hostVars, inventory, groupDepths, context);
  return effectiveVars;
}

function validateWritePolicyContradictions(
  hostName: string,
  globalVars: InventoryVars,
  lineageGroups: Set<string>,
  hostVars: InventoryVars,
  inventory: NormalizedInventory,
  groupDepths: Map<string, number>,
  context: ValidationContext
): void {
  const falseDepths: number[] = [];
  const globalWrite = readBoolean(globalVars.mcp_write_allowed);
  if (globalWrite === false) {
    falseDepths.push(0);
  }

  for (const groupName of lineageGroups) {
    const groupWrite = readBoolean(inventory.groups.get(groupName)?.vars.mcp_write_allowed);
    if (groupWrite === false) {
      falseDepths.push(groupDepths.get(groupName) ?? 1);
    }
  }

  if (falseDepths.length === 0) {
    return;
  }

  if (readBoolean(hostVars.mcp_write_allowed) === true) {
    context.errors.push({
      code: "inventory_write_policy_contradiction",
      message: `Host ${hostName} sets mcp_write_allowed=true beneath an inherited false`,
      path: hostName
    });
  }

  for (const groupName of lineageGroups) {
    const groupWrite = readBoolean(inventory.groups.get(groupName)?.vars.mcp_write_allowed);
    const depth = groupDepths.get(groupName) ?? 1;

    if (groupWrite === true && falseDepths.some((falseDepth) => falseDepth < depth)) {
      context.errors.push({
        code: "inventory_write_policy_contradiction",
        message: `Host ${hostName} inherits mcp_write_allowed=true in group ${groupName} beneath an inherited false`,
        path: hostName
      });
    }
  }
}

function findGroupValueAtDepth(
  key: string,
  depth: number,
  lineageGroups: Set<string>,
  inventory: NormalizedInventory,
  groupDepths: Map<string, number>
): unknown {
  for (const groupName of lineageGroups) {
    if ((groupDepths.get(groupName) ?? 1) !== depth) {
      continue;
    }

    const group = inventory.groups.get(groupName);
    if (group && key in group.vars) {
      return group.vars[key];
    }
  }

  return undefined;
}

function collectLineageGroups(
  hostName: string,
  parentGroups: Map<string, Set<string>>,
  directMemberships: Map<string, Set<string>>
): Set<string> {
  const result = new Set<string>();
  const stack = [...(directMemberships.get(hostName) ?? [])];

  while (stack.length > 0) {
    const groupName = stack.pop();
    if (!groupName || result.has(groupName)) {
      continue;
    }

    result.add(groupName);
    for (const parent of parentGroups.get(groupName) ?? []) {
      stack.push(parent);
    }
  }

  return result;
}

function buildParentGroupMap(inventory: NormalizedInventory): Map<string, Set<string>> {
  const parentGroups = new Map<string, Set<string>>();

  for (const groupName of inventory.groups.keys()) {
    parentGroups.set(groupName, new Set());
  }

  for (const [groupName, group] of inventory.groups.entries()) {
    for (const child of group.children) {
      const parents = parentGroups.get(child) ?? new Set<string>();
      parents.add(groupName);
      parentGroups.set(child, parents);
    }
  }

  return parentGroups;
}

function buildGroupDepths(
  inventory: NormalizedInventory,
  parentGroups: Map<string, Set<string>>
): Map<string, number> {
  const memo = new Map<string, number>();

  const getDepth = (groupName: string): number => {
    const cached = memo.get(groupName);
    if (cached !== undefined) {
      return cached;
    }

    const parents = parentGroups.get(groupName) ?? new Set<string>();
    if (parents.size === 0) {
      memo.set(groupName, 1);
      return 1;
    }

    const depth = Math.max(...[...parents].map(getDepth)) + 1;
    memo.set(groupName, depth);
    return depth;
  };

  for (const groupName of inventory.groups.keys()) {
    getDepth(groupName);
  }

  return memo;
}

function buildDirectMemberships(inventory: NormalizedInventory): Map<string, Set<string>> {
  const memberships = new Map<string, Set<string>>();

  for (const [groupName, group] of inventory.groups.entries()) {
    for (const hostName of group.hosts) {
      const hostMemberships = memberships.get(hostName) ?? new Set<string>();
      hostMemberships.add(groupName);
      memberships.set(hostName, hostMemberships);
    }
  }

  return memberships;
}
