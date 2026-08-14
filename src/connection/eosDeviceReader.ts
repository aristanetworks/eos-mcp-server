import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult, EosCommandRunner, EapiOutputMode, RunShowCommandOptions } from "../eapi/types.js";
import type { InventoryHostModel } from "../inventory/types.js";
import { resolveEapiConnection } from "./resolveConnection.js";

/**
 * Runs EOS read commands for an inventory host.
 *
 * Callers provide inventory identity and command intent; this module owns
 * resolving credentials, endpoint, and TLS settings for the eAPI adapter.
 */
export interface EosDeviceReader {
  runShowCommands(
    host: InventoryHostModel,
    commands: string[],
    outputMode: EapiOutputMode,
    options?: RunShowCommandOptions
  ): Promise<EosCommandResult[]>;
}

export class EapiDeviceReader implements EosDeviceReader {
  constructor(
    private readonly config: ResolvedServerConfig,
    private readonly runner: EosCommandRunner
  ) {}

  runShowCommands(
    host: InventoryHostModel,
    commands: string[],
    outputMode: EapiOutputMode,
    options?: RunShowCommandOptions
  ): Promise<EosCommandResult[]> {
    return this.runner.runShowCommands(
      resolveEapiConnection(this.config, host),
      commands,
      outputMode,
      options
    );
  }
}
