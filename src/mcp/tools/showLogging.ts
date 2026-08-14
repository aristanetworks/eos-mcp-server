import { z } from "zod";
import type { ResolvedServerConfig } from "../../config/schema.js";
import type { EosDeviceReader } from "../../connection/eosDeviceReader.js";
import type { InventoryModel } from "../../inventory/types.js";
import { LOGGING_SEVERITIES } from "../../logging/loggingQuery.js";
import { showLogging } from "../../logging/showLogging.js";
import { buildJsonToolResult } from "../toolResult.js";

export const showLoggingInputSchema = z
  .object({
    target: z.string().min(1),
    minimum_severity: z.enum(LOGGING_SEVERITIES).optional().default("warnings"),
    message_count: z.number().int().min(1).max(9999).optional().default(100)
  })
  .strict();

export async function buildShowLoggingToolResult(
  inventoryModel: InventoryModel,
  config: ResolvedServerConfig,
  args: z.infer<typeof showLoggingInputSchema>,
  reader: EosDeviceReader
) {
  const payload = await showLogging(
    inventoryModel,
    config,
    {
      target: args.target,
      minimumSeverity: args.minimum_severity,
      messageCount: args.message_count
    },
    reader
  );

  return buildJsonToolResult(payload);
}
