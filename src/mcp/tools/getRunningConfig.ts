import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { InventoryModel } from "../../inventory/types.js";
import type { RunningConfigRunner } from "../../configuration/getRunningConfig.js";
import { getRunningConfig } from "../../configuration/getRunningConfig.js";
import { buildJsonToolResult } from "../toolResult.js";

export const getRunningConfigInputSchema = z
  .object({
    target: z.string().min(1),
    section: z.string().min(1).optional()
  })
  .strict();

export async function buildGetRunningConfigToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof getRunningConfigInputSchema>,
  runner: RunningConfigRunner
) {
  const payload = await getRunningConfig(
    inventoryModel,
    config,
    {
      target: args.target,
      ...(args.section !== undefined ? { section: args.section } : {})
    },
    runner
  );

  return buildJsonToolResult(payload);
}
