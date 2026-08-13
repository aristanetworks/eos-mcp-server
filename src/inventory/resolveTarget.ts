import { AppError } from "../core/errors.js";
import type { InventoryHostModel, InventoryModel } from "./types.js";

export interface ResolveInventoryTargetOptions {
  target: string;
}

export interface ResolvedInventoryTarget {
  target: string;
  targetType: "host" | "group";
  resolvedHosts: InventoryHostModel[];
}

export class InventoryResolutionError extends AppError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export function resolveInventoryTarget(
  model: InventoryModel,
  options: ResolveInventoryTargetOptions
): ResolvedInventoryTarget {
  const { target } = options;

  const directHost = model.hostMap.get(target);
  if (directHost) {
    validateHostsForOperation([directHost], target);
    return {
      target,
      targetType: "host",
      resolvedHosts: [directHost]
    };
  }

  const group = model.groupMap.get(target);
  if (!group) {
    throw new InventoryResolutionError("target_not_found", `Unknown inventory target ${target}`);
  }

  const resolvedHosts = group.resolvedHosts.map((hostName) => {
    const host = model.hostMap.get(hostName);
    if (!host) {
      throw new InventoryResolutionError("target_resolution_failed", `Resolved host ${hostName} is missing from inventory host map`);
    }
    return host;
  });

  validateHostsForOperation(resolvedHosts, target);

  return {
    target,
    targetType: "group",
    resolvedHosts
  };
}

function validateHostsForOperation(
  hosts: InventoryHostModel[],
  target: string
): void {
  if (hosts.length === 0) {
    throw new InventoryResolutionError("no_eligible_targets", `Target ${target} resolved to zero hosts`);
  }

  const deniedHosts: string[] = [];

  for (const host of hosts) {
    if (!host.eligible) {
      deniedHosts.push(host.inventoryHostname);
      continue;
    }

    if (!host.readAllowed) {
      deniedHosts.push(host.inventoryHostname);
      continue;
    }
  }

  if (deniedHosts.length > 0) {
    throw new InventoryResolutionError(
      "policy_denied",
      `Policy denied: target ${target} includes host(s) not permitted for read operations: ${deniedHosts.sort().join(", ")}`
    );
  }
}
