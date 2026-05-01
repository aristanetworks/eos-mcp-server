import { z } from "zod";
import { buildListInventoryView } from "../../inventory/listInventoryView.js";
import type { InventoryModel } from "../../inventory/types.js";
import { buildJsonToolResult } from "../toolResult.js";

export const listInventoryInputSchema = z
  .object({
    include_ineligible: z.boolean().optional().default(false)
  })
  .strict();

export function buildListInventoryToolResult(
  inventoryModel: InventoryModel,
  args: z.infer<typeof listInventoryInputSchema>
) {
  const payload = buildListInventoryView(inventoryModel, {
    includeIneligible: args.include_ineligible ?? false
  });

  return buildJsonToolResult(payload);
}
