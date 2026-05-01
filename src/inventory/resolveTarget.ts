import { AppError } from "../core/errors.js";
import type { InventoryHostModel, InventoryModel } from "./types.js";

export type OperationKind = "read" | "write";

export interface ResolveInventoryTargetOptions {
  target: string;
  operationKind: OperationKind;
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
  const { target, operationKind } = options;

  if (operationKind === "write" && target === "all") {
    throw new InventoryResolutionError("write_target_all_forbidden", "The special group all is read-only and may not be used for write operations");
  }

  const directHost = model.hostMap.get(target);
  if (directHost) {
    validateHostsForOperation([directHost], operationKind, target);
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

  validateHostsForOperation(resolvedHosts, operationKind, target);

  return {
    target,
    targetType: "group",
    resolvedHosts
  };
}

function validateHostsForOperation(
  hosts: InventoryHostModel[],
  operationKind: OperationKind,
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

    if (operationKind === "read" && !host.readAllowed) {
      deniedHosts.push(host.inventoryHostname);
      continue;
    }

    if (operationKind === "write" && !host.writeAllowed) {
      deniedHosts.push(host.inventoryHostname);
      continue;
    }
  }

  if (deniedHosts.length > 0) {
    throw new InventoryResolutionError(
      "policy_denied",
      `Policy denied: target ${target} includes host(s) not permitted for ${operationKind}: ${deniedHosts.sort().join(", ")}`
    );
  }
}
