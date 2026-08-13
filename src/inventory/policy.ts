import { readBoolean, readString } from "../utils/value.js";
import type { InventoryValidationError } from "./types.js";

export interface HostEligibilityEvaluation {
  eligible: boolean;
  ineligibilityReasons: string[];
  errors: InventoryValidationError[];
}

export interface HostAccessEvaluation {
  readAllowed: boolean;
}

export function evaluateHostEligibility(
  hostName: string,
  effectiveVars: Record<string, unknown>
): HostEligibilityEvaluation {
  const ansibleNetworkOs = readString(effectiveVars.ansible_network_os);
  const mcpPlatform = readString(effectiveVars.mcp_platform);
  const errors: InventoryValidationError[] = [];

  if (
    ansibleNetworkOs !== undefined &&
    mcpPlatform !== undefined &&
    ((ansibleNetworkOs === "eos") !== (mcpPlatform === "arista_eos"))
  ) {
    errors.push({
      code: "inventory_platform_conflict",
      message: `Host ${hostName} has conflicting platform declarations ansible_network_os=${ansibleNetworkOs} and mcp_platform=${mcpPlatform}`,
      path: hostName
    });
  }

  const eligible = ansibleNetworkOs === "eos" || mcpPlatform === "arista_eos";

  return {
    eligible,
    ineligibilityReasons: eligible ? [] : ["host is not explicitly marked as EOS eligible"],
    errors
  };
}

export function evaluateHostAccess(
  eligible: boolean,
  effectiveVars: Record<string, unknown>
): HostAccessEvaluation {
  return {
    readAllowed: eligible ? readBoolean(effectiveVars.mcp_read_allowed) ?? true : false
  };
}

