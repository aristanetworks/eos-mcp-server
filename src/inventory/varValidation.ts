import type { InventoryVars, NormalizedInventory, ValidationContext } from "./internalTypes.js";

const BOOLEAN_VAR_KEYS = new Set([
  "mcp_read_allowed",
  "mcp_write_allowed",
  "mcp_validate_certs",
  "ansible_httpapi_validate_certs"
]);

const NON_EMPTY_STRING_VAR_KEYS = new Set([
  "ansible_host",
  "ansible_user",
  "ansible_network_os",
  "mcp_platform",
  "mcp_password_env",
  "ansible_password"
]);

const POSITIVE_INTEGER_VAR_KEYS = new Set(["ansible_httpapi_port"]);

export function validateKnownInventoryVarTypes(inventory: NormalizedInventory, context: ValidationContext): void {
  validateVarSet(inventory.globalVars, "vars", context);

  for (const group of inventory.groups.values()) {
    validateVarSet(group.vars, `groups.${group.name}.vars`, context);
  }

  for (const [hostName, hostVars] of inventory.hosts.entries()) {
    validateVarSet(hostVars, `hosts.${hostName}`, context);
  }
}

function validateVarSet(vars: InventoryVars, pathLabel: string, context: ValidationContext): void {
  for (const [key, value] of Object.entries(vars)) {
    const valuePath = `${pathLabel}.${key}`;

    if (BOOLEAN_VAR_KEYS.has(key) && typeof value !== "boolean") {
      addTypeError(context, valuePath, key, value, "a boolean");
      continue;
    }

    if (NON_EMPTY_STRING_VAR_KEYS.has(key) && !isNonEmptyString(value)) {
      addTypeError(context, valuePath, key, value, "a non-empty string");
      continue;
    }

    if (POSITIVE_INTEGER_VAR_KEYS.has(key) && !isPositiveIntegerLike(value)) {
      addTypeError(context, valuePath, key, value, "a positive integer or positive integer string");
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveIntegerLike(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0;
  }

  return false;
}

function addTypeError(context: ValidationContext, path: string, key: string, value: unknown, expected: string): void {
  context.errors.push({
    code: "inventory_var_type_invalid",
    message: `${path} must be ${expected}; got ${key}=${JSON.stringify(value)}`,
    path
  });
}
