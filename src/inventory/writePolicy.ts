import type { InventoryVars, NormalizedInventory, ValidationContext } from "./internalTypes.js";
import { readBoolean } from "../utils/value.js";

export function validateWritePolicyContradictions(
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
