import type { NormalizedInventory } from "./internalTypes.js";

export function resolveGroupHosts(
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

export function collectLineageGroups(
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

export function buildParentGroupMap(inventory: NormalizedInventory): Map<string, Set<string>> {
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

export function buildGroupDepths(
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

export function buildDirectMemberships(inventory: NormalizedInventory): Map<string, Set<string>> {
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
