import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { EosCommandRunner } from "../../eapi/types.js";
import type { InventoryModel } from "../../inventory/types.js";
import { probeDevices } from "../../probe/probeDevices.js";
import { buildJsonToolResult } from "../toolResult.js";

export const probeDevicesInputSchema = z
  .object({
    target: z.string().min(1),
    include_raw: z.boolean().optional().default(false)
  })
  .strict();

export async function buildProbeDevicesToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof probeDevicesInputSchema>,
  runner: EosCommandRunner
) {
  const payload = await probeDevices(
    inventoryModel,
    config,
    { target: args.target, include_raw: args.include_raw ?? false },
    runner
  );

  return buildJsonToolResult(payload);
}
