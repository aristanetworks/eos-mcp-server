import { readBoolean, readString } from "../utils/value.js";
import type { InventoryValidationError } from "./types.js";

export interface HostEligibilityEvaluation {
  eligible: boolean;
  ineligibilityReasons: string[];
  errors: InventoryValidationError[];
}

export interface HostAccessEvaluation {
  readAllowed: boolean;
  diagnosticsAllowed: boolean;
  packetCaptureAllowed: boolean;
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
  // Every permission is granted unless inventory sets it to boolean false.
  const notDenied = (key: string): boolean => readBoolean(effectiveVars[key]) ?? true;
  const readAllowed = eligible && notDenied("mcp_read_allowed");
  const diagnosticsAllowed = readAllowed && notDenied("mcp_diagnostics_allowed");
  return {
    readAllowed,
    diagnosticsAllowed,
    packetCaptureAllowed: diagnosticsAllowed && notDenied("mcp_packet_capture_allowed")
  };
}

