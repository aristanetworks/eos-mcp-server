import type { NormalizedInventory, ValidationContext } from "./internalTypes.js";
import { validateSafeName } from "./internalUtils.js";

export function validateNormalizedInventory(inventory: NormalizedInventory, context: ValidationContext): void {
  validateGroupReferences(inventory, context);
  validateGroupGraph(inventory, context);
}

function validateGroupReferences(inventory: NormalizedInventory, context: ValidationContext): void {
  for (const group of inventory.groups.values()) {
    for (const hostName of group.hosts) {
      validateSafeName(hostName, "host", context, `groups.${group.name}.hosts`);
      if (!inventory.hosts.has(hostName)) {
        context.errors.push({
          code: "inventory_group_host_missing",
          message: `Group ${group.name} references unknown host ${hostName}`,
          path: `groups.${group.name}.hosts`
        });
      }
    }

    for (const childName of group.children) {
      validateSafeName(childName, "group", context, `groups.${group.name}.children`);
      if (!inventory.groups.has(childName)) {
        context.errors.push({
          code: "inventory_group_child_missing",
          message: `Group ${group.name} references unknown child group ${childName}`,
          path: `groups.${group.name}.children`
        });
      }
    }
  }
}

function validateGroupGraph(inventory: NormalizedInventory, context: ValidationContext): void {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  for (const groupName of inventory.groups.keys()) {
    visit(groupName);
  }

  function visit(groupName: string): void {
    if (visited.has(groupName)) {
      return;
    }
    if (inStack.has(groupName)) {
      const cycleStart = stack.indexOf(groupName);
      const cyclePath = [...stack.slice(cycleStart), groupName].join(" -> ");
      context.errors.push({
        code: "inventory_group_cycle",
        message: `Inventory group graph contains a cycle: ${cyclePath}`,
        path: groupName
      });
      return;
    }

    inStack.add(groupName);
    stack.push(groupName);

    const group = inventory.groups.get(groupName);
    for (const child of group?.children ?? []) {
      if (inventory.groups.has(child)) {
        visit(child);
      }
    }

    stack.pop();
    inStack.delete(groupName);
    visited.add(groupName);
  }
}
