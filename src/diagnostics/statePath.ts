import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";

export function diagnosticInventoryIdentity(inventoryPath: string): string {
  try {
    return createHash("sha256").update(fs.realpathSync(inventoryPath)).digest("hex");
  } catch {
    throw new AppError("diagnostic_inventory_identity_invalid", "Cannot establish the canonical inventory identity for diagnostic state");
  }
}

export function resolveDiagnosticStateFile(config: ResolvedServerConfig): string {
  const file = config.diagnostics.stateFile ?? (config.inventoryPath === undefined ? undefined : defaultDiagnosticStateFile(config.inventoryPath));
  if (file === undefined) throw new AppError("cli_missing_diagnostic_state", "Diagnostic administration requires diagnostics.stateFile in config or an inventory path");
  return file;
}

export function defaultDiagnosticStateFile(inventoryPath: string): string {
  const configured = process.env.XDG_STATE_HOME;
  const root = configured !== undefined && path.isAbsolute(configured) ? configured : path.join(os.homedir(), ".local", "state");
  return path.join(root, "eos-mcp-server", diagnosticInventoryIdentity(inventoryPath), "diagnostics.sqlite");
}
