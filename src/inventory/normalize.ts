import type { InventorySchemaKind } from "./types.js";
import type { InventoryVars, NormalizedGroup, NormalizedInventory, ValidationContext } from "./internalTypes.js";
import {
  CANONICAL_GROUP_KEYS,
  SIMPLIFIED_GROUP_KEYS,
  SIMPLIFIED_ROOT_KEYS,
  isObject,
  readStringList,
  readVarsObject,
  validateSafeName
} from "./internalUtils.js";

export function detectSchemaKind(value: unknown): InventorySchemaKind {
  if (!isObject(value)) {
    throw new Error("Inventory root must be a mapping/object");
  }

  if ("all" in value) {
    return "canonical-ansible-yaml";
  }

  if ("hosts" in value || "groups" in value || "vars" in value || "version" in value) {
    return "simplified-yaml";
  }

  throw new Error("Unsupported inventory schema: expected canonical all: root or simplified vars/hosts/groups root");
}

export function normalizeInventory(
  value: unknown,
  schemaKind: InventorySchemaKind,
  context: ValidationContext
): NormalizedInventory | null {
  return schemaKind === "simplified-yaml"
    ? normalizeSimplifiedInventory(value, context)
    : normalizeCanonicalInventory(value, context);
}

function normalizeSimplifiedInventory(value: unknown, context: ValidationContext): NormalizedInventory | null {
  if (!isObject(value)) {
    context.errors.push({
      code: "inventory_root_invalid",
      message: "Simplified inventory root must be a mapping/object"
    });
    return null;
  }

  for (const key of Object.keys(value)) {
    if (!SIMPLIFIED_ROOT_KEYS.has(key)) {
      context.errors.push({
        code: "inventory_structural_key_invalid",
        message: `Unsupported top-level key in simplified inventory: ${key}`,
        path: key
      });
    }
  }

  if (value.version !== undefined && value.version !== 1) {
    context.errors.push({
      code: "inventory_version_invalid",
      message: `Unsupported simplified inventory version: ${String(value.version)}`,
      path: "version"
    });
  }

  const globalVars = readVarsObject(value.vars, context, "vars");
  const hosts = new Map<string, InventoryVars>();
  const groups = new Map<string, NormalizedGroup>();

  if (value.hosts !== undefined && !isObject(value.hosts)) {
    context.errors.push({
      code: "inventory_hosts_invalid",
      message: "Simplified inventory hosts must be a mapping/object",
      path: "hosts"
    });
  }

  if (isObject(value.hosts)) {
    for (const [hostName, hostValue] of Object.entries(value.hosts)) {
      validateSafeName(hostName, "host", context, `hosts.${hostName}`);

      if (!isObject(hostValue)) {
        context.errors.push({
          code: "inventory_host_invalid",
          message: `Host ${hostName} must be a mapping/object of direct host vars`,
          path: `hosts.${hostName}`
        });
        continue;
      }

      hosts.set(hostName, { ...hostValue });
    }
  }

  if (value.groups !== undefined && !isObject(value.groups)) {
    context.errors.push({
      code: "inventory_groups_invalid",
      message: "Simplified inventory groups must be a mapping/object",
      path: "groups"
    });
  }

  if (isObject(value.groups)) {
    for (const [groupName, groupValue] of Object.entries(value.groups)) {
      validateSafeName(groupName, "group", context, `groups.${groupName}`);

      if (groupName === "all") {
        context.errors.push({
          code: "inventory_group_reserved",
          message: "Simplified inventory may not define groups.all; all is implicit/reserved",
          path: `groups.${groupName}`
        });
        continue;
      }

      if (hosts.has(groupName)) {
        context.errors.push({
          code: "inventory_name_collision",
          message: `Host/group name collision: ${groupName}`,
          path: `groups.${groupName}`
        });
      }

      if (!isObject(groupValue)) {
        context.errors.push({
          code: "inventory_group_invalid",
          message: `Group ${groupName} must be a mapping/object`,
          path: `groups.${groupName}`
        });
        continue;
      }

      for (const key of Object.keys(groupValue)) {
        if (!SIMPLIFIED_GROUP_KEYS.has(key)) {
          context.errors.push({
            code: "inventory_group_structural_key_invalid",
            message: `Unsupported key ${key} in simplified group ${groupName}`,
            path: `groups.${groupName}.${key}`
          });
        }
      }

      groups.set(groupName, {
        name: groupName,
        vars: readVarsObject(groupValue.vars, context, `groups.${groupName}.vars`),
        hosts: readStringList(groupValue.hosts, context, `groups.${groupName}.hosts`),
        children: readStringList(groupValue.children, context, `groups.${groupName}.children`)
      });
    }
  }

  return {
    schemaKind: "simplified-yaml",
    globalVars,
    hosts,
    groups
  };
}

function normalizeCanonicalInventory(value: unknown, context: ValidationContext): NormalizedInventory | null {
  if (!isObject(value) || !isObject(value.all)) {
    context.errors.push({
      code: "inventory_root_invalid",
      message: "Canonical inventory must contain an all mapping/object",
      path: "all"
    });
    return null;
  }

  const allNode = value.all;
  const globalVars = readVarsObject(allNode.vars, context, "all.vars");
  const hosts = new Map<string, InventoryVars>();
  const groups = new Map<string, NormalizedGroup>();

  walkCanonicalGroup("all", allNode, hosts, groups, context, true);

  for (const hostName of hosts.keys()) {
    if (groups.has(hostName)) {
      context.errors.push({
        code: "inventory_name_collision",
        message: `Host/group name collision: ${hostName}`,
        path: hostName
      });
    }
  }

  groups.delete("all");

  return {
    schemaKind: "canonical-ansible-yaml",
    globalVars,
    hosts,
    groups
  };
}

function walkCanonicalGroup(
  groupName: string,
  node: Record<string, unknown>,
  hosts: Map<string, InventoryVars>,
  groups: Map<string, NormalizedGroup>,
  context: ValidationContext,
  isRoot = false
): void {
  validateSafeName(groupName, "group", context, groupName);

  for (const key of Object.keys(node)) {
    if (!CANONICAL_GROUP_KEYS.has(key)) {
      context.errors.push({
        code: "inventory_group_structural_key_invalid",
        message: `Unsupported key ${key} in canonical group ${groupName}`,
        path: `${groupName}.${key}`
      });
    }
  }

  const vars = readVarsObject(node.vars, context, `${groupName}.vars`);
  const hostNames: string[] = [];
  const childGroups: string[] = [];

  if (node.hosts !== undefined && !isObject(node.hosts)) {
    context.errors.push({
      code: "inventory_hosts_invalid",
      message: `Canonical group ${groupName} hosts must be a mapping/object`,
      path: `${groupName}.hosts`
    });
  }

  if (isObject(node.hosts)) {
    for (const [hostName, hostNode] of Object.entries(node.hosts)) {
      validateSafeName(hostName, "host", context, `${groupName}.hosts.${hostName}`);
      hostNames.push(hostName);

      if (hostNode !== undefined && !isObject(hostNode)) {
        context.errors.push({
          code: "inventory_host_invalid",
          message: `Canonical host ${hostName} must be a mapping/object`,
          path: `${groupName}.hosts.${hostName}`
        });
        continue;
      }

      if (!hosts.has(hostName)) {
        hosts.set(hostName, isObject(hostNode) ? { ...hostNode } : {});
      } else if (isObject(hostNode) && Object.keys(hostNode).length > 0) {
        context.errors.push({
          code: "inventory_host_duplicate_definition",
          message: `Canonical host ${hostName} is defined with vars in multiple locations`,
          path: `${groupName}.hosts.${hostName}`
        });
      }
    }
  }

  if (node.children !== undefined && !isObject(node.children)) {
    context.errors.push({
      code: "inventory_children_invalid",
      message: `Canonical group ${groupName} children must be a mapping/object`,
      path: `${groupName}.children`
    });
  }

  if (isObject(node.children)) {
    for (const [childGroupName, childNode] of Object.entries(node.children)) {
      validateSafeName(childGroupName, "group", context, `${groupName}.children.${childGroupName}`);
      childGroups.push(childGroupName);

      if (childNode === null || childNode === undefined) {
        // Bare key reference (e.g. group listed under multiple parents) — treat as empty group
        walkCanonicalGroup(childGroupName, {} as Record<string, unknown>, hosts, groups, context);
        continue;
      }

      if (!isObject(childNode)) {
        context.errors.push({
          code: "inventory_group_invalid",
          message: `Canonical child group ${childGroupName} must be a mapping/object`,
          path: `${groupName}.children.${childGroupName}`
        });
        continue;
      }

      walkCanonicalGroup(childGroupName, childNode, hosts, groups, context);
    }
  }

  if (!isRoot) {
    groups.set(groupName, {
      name: groupName,
      vars,
      hosts: hostNames,
      children: childGroups
    });
  }
}
