import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { collectStartupConnectionValidationErrors } from "../connection/validateStartupConnections.js";
import { loadInventoryModel, validateInventory } from "../inventory/loadInventory.js";
import type { InventoryValidationResult } from "../inventory/types.js";
import { prettyJson } from "../utils/json.js";

export async function buildValidateInventoryResult(
  config: ResolvedServerConfig,
  options: { inventoryOnly: boolean }
): Promise<InventoryValidationResult> {
  if (!config.inventoryPath) {
    throw new AppError("inventory_path_missing", "validate-inventory requires an inventory path via --inventory or config file");
  }

  const inventoryPath = config.inventoryPath;
  const inventoryResult = await validateInventory(inventoryPath);

  if (!inventoryResult.ok) {
    return {
      ...inventoryResult,
      notes: options.inventoryOnly
        ? [...inventoryResult.notes, "Inventory-only mode skips startup connection validation."]
        : [...inventoryResult.notes, "Effective validation stopped before startup connection checks due to inventory errors."]
    };
  }

  if (options.inventoryOnly) {
    return {
      ...inventoryResult,
      notes: [...inventoryResult.notes, "Inventory-only mode skips startup connection validation."]
    };
  }

  const model = await loadInventoryModel(inventoryPath);
  const startupErrors = collectStartupConnectionValidationErrors(config, model);

  return {
    ...inventoryResult,
    ok: startupErrors.length === 0,
    errors: [...inventoryResult.errors, ...startupErrors],
    notes: [...inventoryResult.notes, "Effective validation included startup connection checks for EOS-eligible hosts."]
  };
}

export async function runValidateInventory(
  config: ResolvedServerConfig,
  options: { asJson: boolean; inventoryOnly: boolean }
): Promise<number> {
  const result = await buildValidateInventoryResult(config, { inventoryOnly: options.inventoryOnly });

  if (options.asJson) {
    console.log(prettyJson(result));
  } else if (result.ok) {
    console.log(`Inventory valid: ${result.summary?.basename ?? config.inventoryPath ?? "(unknown)"}`);
    console.log(`Schema: ${result.schemaKind}`);
    console.log(`Hosts: ${result.summary?.totalHostCount ?? 0}`);
    console.log(`Groups: ${result.summary?.totalGroupCount ?? 0}`);

    for (const note of result.notes) {
      console.log(`Note: ${note}`);
    }
  } else {
    console.error("Inventory validation failed:");
    for (const error of result.errors) {
      console.error(`- [${error.code}] ${error.message}`);
    }

    for (const note of result.notes) {
      console.error(`Note: ${note}`);
    }
  }

  return result.ok ? 0 : 1;
}
