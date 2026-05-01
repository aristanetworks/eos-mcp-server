export type InventorySchemaKind = "canonical-ansible-yaml" | "simplified-yaml";

export interface InventorySummary {
  path: string;
  basename: string;
  schemaKind: InventorySchemaKind;
  totalHostCount: number;
  totalGroupCount: number;
  eosEligibleHostCount: number | null;
  readAllowedHostCount: number | null;
  writeAllowedHostCount: number | null;
}

export interface InventoryValidationError {
  code: string;
  message: string;
  path?: string;
}

export interface InventoryValidationResult {
  ok: boolean;
  schemaKind?: InventorySchemaKind;
  summary?: InventorySummary;
  errors: InventoryValidationError[];
  notes: string[];
}

export interface InventoryHostModel {
  inventoryHostname: string;
  resolvedEndpoint: string;
  effectiveVars: Record<string, unknown>;
  eligible: boolean;
  readAllowed: boolean;
  writeAllowed: boolean;
  ineligibilityReasons: string[];
  groupMemberships: string[];
}

export interface InventoryGroupModel {
  name: string;
  hosts: string[];
  children: string[];
  resolvedHosts: string[];
  eligibleHostCount: number;
  ineligibleHostCount: number;
  actionable: boolean;
}

export interface InventoryModel {
  path: string;
  basename: string;
  schemaKind: InventorySchemaKind;
  summary: InventorySummary;
  hosts: InventoryHostModel[];
  groups: InventoryGroupModel[];
  hostMap: Map<string, InventoryHostModel>;
  groupMap: Map<string, InventoryGroupModel>;
}
