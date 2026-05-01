import type { InventorySchemaKind, InventoryValidationError } from "./types.js";

export type InventoryVars = Record<string, unknown>;

export interface NormalizedInventory {
  schemaKind: InventorySchemaKind;
  globalVars: InventoryVars;
  hosts: Map<string, InventoryVars>;
  groups: Map<string, NormalizedGroup>;
}

export interface NormalizedGroup {
  name: string;
  vars: InventoryVars;
  hosts: string[];
  children: string[];
}

export interface ValidationContext {
  errors: InventoryValidationError[];
}
