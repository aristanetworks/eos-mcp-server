import type { ResolvedServerConfig } from "../config/schema.js";
import type { EosCommandResult, EosCommandRunner, EapiOutputMode, RunShowCommandOptions } from "../eapi/types.js";
import type { InventoryHostModel } from "../inventory/types.js";
import type { EapiSlots } from "../operations/eapiSlots.js";
import { resolveEapiConnection } from "./resolveConnection.js";

const neverAborted = new AbortController().signal;

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

/** With `slots`, each request first waits for one of the host's shared eAPI slots and frees it when
 * the request settles (ADR 0009), so `readTimeoutMs` starts at dispatch, not while queued.
 */
export class EapiDeviceReader implements EosDeviceReader {
  constructor(
    private readonly config: ResolvedServerConfig,
    private readonly runner: EosCommandRunner,
    private readonly slots?: EapiSlots
  ) {}

  async runShowCommands(
    host: InventoryHostModel,
    commands: string[],
    outputMode: EapiOutputMode,
    options?: RunShowCommandOptions
  ): Promise<EosCommandResult[]> {
    const release = await this.slots?.acquireRead(options?.signal ?? neverAborted, host.inventoryHostname);
    try {
      return await this.runner.runShowCommands(
        resolveEapiConnection(this.config, host),
        commands,
        outputMode,
        options
      );
    } finally {
      release?.();
    }
  }
}
