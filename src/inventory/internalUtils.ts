import { isObject } from "../utils/value.js";
import type { InventoryVars, ValidationContext } from "./internalTypes.js";

const SAFE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const SIMPLIFIED_ROOT_KEYS = new Set(["version", "vars", "hosts", "groups"]);
export const SIMPLIFIED_GROUP_KEYS = new Set(["vars", "hosts", "children"]);
export const CANONICAL_GROUP_KEYS = new Set(["vars", "hosts", "children"]);

export function readVarsObject(value: unknown, context: ValidationContext, pathLabel: string): InventoryVars {
  if (value === undefined) {
    return {};
  }

  if (!isObject(value)) {
    context.errors.push({
      code: "inventory_vars_invalid",
      message: `${pathLabel} must be a mapping/object`,
      path: pathLabel
    });
    return {};
  }

  return { ...value };
}

export function readStringList(value: unknown, context: ValidationContext, pathLabel: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    context.errors.push({
      code: "inventory_list_invalid",
      message: `${pathLabel} must be a list/array of strings`,
      path: pathLabel
    });
    return [];
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      context.errors.push({
        code: "inventory_list_entry_invalid",
        message: `${pathLabel} entries must be strings`,
        path: pathLabel
      });
      continue;
    }

    result.push(entry);
  }

  return result;
}

export function validateSafeName(
  name: string,
  kind: "host" | "group",
  context: ValidationContext,
  pathLabel: string
): void {
  if (!SAFE_NAME_PATTERN.test(name)) {
    context.errors.push({
      code: "inventory_name_invalid",
      message: `Invalid ${kind} name ${JSON.stringify(name)}; expected pattern ${SAFE_NAME_PATTERN.source}`,
      path: pathLabel
    });
  }
}

export { isObject };

export function stableValueKey(value: unknown): string {
  return JSON.stringify(value);
}

