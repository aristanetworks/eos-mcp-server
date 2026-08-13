import { AppError, getErrorCode, toErrorMessage } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { InventoryModel, InventoryValidationError } from "../inventory/types.js";
import { resolveEapiConnection } from "./resolveConnection.js";

export function collectStartupConnectionValidationErrors(
  config: ResolvedServerConfig,
  model: InventoryModel
): InventoryValidationError[] {
  const errors: InventoryValidationError[] = [];

  for (const host of model.hosts) {
    if (!host.eligible) {
      continue;
    }

    try {
      resolveEapiConnection(config, host);
    } catch (error) {
      errors.push({
        code: getErrorCode(error) ?? "startup_connection_invalid",
        message: `${host.inventoryHostname}: ${toErrorMessage(error)}`,
        path: host.inventoryHostname
      });
    }
  }

  return errors;
}

export function validateStartupConnections(config: ResolvedServerConfig, model: InventoryModel): void {
  const errors = collectStartupConnectionValidationErrors(config, model);

  if (errors.length > 0) {
    throw new AppError(
      "startup_connection_validation_failed",
      `Startup connection validation failed: ${errors.map((error) => error.message).join("; ")}`,
      { errors }
    );
  }
}
