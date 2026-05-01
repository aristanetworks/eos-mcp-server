import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { InventoryModel } from "../../inventory/types.js";
import type { ProbeRunner } from "../../probe/probeDevices.js";
import { probeDevices } from "../../probe/probeDevices.js";
import { buildJsonToolResult } from "../toolResult.js";

export const probeDevicesInputSchema = z
  .object({
    target: z.string().min(1)
  })
  .strict();

export async function buildProbeDevicesToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof probeDevicesInputSchema>,
  runner: ProbeRunner
) {
  const payload = await probeDevices(inventoryModel, config, args, runner);

  return buildJsonToolResult(payload);
}
