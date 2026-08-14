import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { EosDeviceReader } from "../../connection/eosDeviceReader.js";
import type { InventoryModel } from "../../inventory/types.js";
import { getFacts } from "../../facts/getFacts.js";
import { buildJsonToolResult } from "../toolResult.js";

export const getFactsInputSchema = z
  .object({
    target: z.string().min(1),
    include_raw: z.boolean().optional().default(false)
  })
  .strict();

export async function buildGetFactsToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof getFactsInputSchema>,
  reader: EosDeviceReader
) {
  const payload = await getFacts(
    inventoryModel,
    config,
    {
      target: args.target,
      include_raw: args.include_raw ?? false
    },
    reader
  );

  return buildJsonToolResult(payload);
}
