import type { InventoryVars, NormalizedInventory, ValidationContext } from "./internalTypes.js";
import { stableValueKey } from "./internalUtils.js";

export function resolveEffectiveHostVars(
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

  return effectiveVars;
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
