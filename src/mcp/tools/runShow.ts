import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import { AppError } from "../../core/errors.js";
import type { EosDeviceReader } from "../../connection/eosDeviceReader.js";
import type { InventoryModel } from "../../inventory/types.js";
import { runShow } from "../../show/runShow.js";
import { buildJsonToolResult } from "../toolResult.js";

// NOTE: this schema intentionally ends at `.strict()` and validates the
// `command` XOR `commands` requirement in the handler below. Wrapping the
// ZodObject with `.superRefine()` (or `.refine()`) turns it into a ZodEffects
// instance, which hides `.shape` from the MCP SDK's `normalizeObjectSchema`
// and causes the tool to be advertised with an empty input schema.
export const runShowInputSchema = z
  .object({
    target: z.string().min(1),
    command: z.string().min(1).optional(),
    commands: z.array(z.string().min(1)).optional(),
    output_format: z.enum(["auto", "json", "text"]).default("auto"),
    include_raw: z.boolean().optional().default(false)
  })
  .strict();

export async function buildRunShowToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof runShowInputSchema>,
  reader: EosDeviceReader
) {
  const hasCommand = args.command !== undefined;
  const hasCommands = args.commands !== undefined;
  if (hasCommand === hasCommands) {
    throw new AppError(
      "show_commands_input_invalid",
      "Exactly one of command or commands must be provided"
    );
  }

  const commands = args.commands ?? (args.command ? [args.command] : []);
  const payload = await runShow(
    inventoryModel,
    config,
    {
      target: args.target,
      commands,
      outputFormat: args.output_format,
      includeRaw: args.include_raw ?? false
    },
    reader
  );

  return buildJsonToolResult(payload);
}
