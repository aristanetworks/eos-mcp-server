import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { InventoryModel } from "../../inventory/types.js";
import type { ShowRunner } from "../../show/runShow.js";
import { runShow } from "../../show/runShow.js";
import { buildJsonToolResult } from "../toolResult.js";

export const runShowInputSchema = z
  .object({
    target: z.string().min(1),
    command: z.string().min(1).optional(),
    commands: z.array(z.string().min(1)).optional(),
    output_format: z.enum(["auto", "json", "text"]).default("auto")
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasCommand = value.command !== undefined;
    const hasCommands = value.commands !== undefined;

    if (hasCommand === hasCommands) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of command or commands must be provided",
        path: ["command"]
      });
    }
  });

export async function buildRunShowToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof runShowInputSchema>,
  runner: ShowRunner
) {
  const commands = args.commands ?? (args.command ? [args.command] : []);
  const payload = await runShow(
    inventoryModel,
    config,
    {
      target: args.target,
      commands,
      outputFormat: args.output_format
    },
    runner
  );

  return buildJsonToolResult(payload);
}
