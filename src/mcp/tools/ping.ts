import { z } from "zod";
import type { DiagnosticExecutor } from "../../diagnostics/executor.js";
import { AppError } from "../../core/errors.js";
import { buildJsonToolResult } from "../toolResult.js";

export const pingInputSchema = z.object({
  target: z.string().min(1).describe("Inventory host or group executing the diagnostic"),
  destination: z.string().min(1).describe("Unicast IPv4/IPv6 literal to test; need not be in inventory"),
  count: z.number().int().positive().optional().describe("Packet count, bounded by server settings; defaults to diagnostics.defaultPingCount"),
  vrf: z.string().min(1).optional().describe("Explicit VRF; omission uses the EOS default"),
  source: z.string().min(1).optional().describe("Source IP literal in the same address family as destination"),
  include_raw: z.boolean().default(false)
}).strict();

export async function buildPingToolResult(
  args: z.infer<typeof pingInputSchema>,
  executor: DiagnosticExecutor,
  signal?: AbortSignal
) {
  try {
    const payload = await executor.execute({
      target: args.target,
      request: {
        kind: "ping",
        destination: args.destination,
        ...(args.count === undefined ? {} : { count: args.count }),
        ...(args.vrf === undefined ? {} : { vrf: args.vrf }),
        ...(args.source === undefined ? {} : { source: args.source })
      },
      includeRaw: args.include_raw,
      ...(signal === undefined ? {} : { signal })
    });
    return buildJsonToolResult(payload);
  } catch (error) {
    if (error instanceof AppError && (error.code === "diagnostic_capacity_uncertain" || error.code.startsWith("diagnostic_state_"))) {
      // The SDK otherwise reduces thrown errors to text and drops AppError.code.
      return {
        ...buildJsonToolResult({ error_code: error.code, message: error.message }),
        isError: true
      };
    }
    throw error;
  }
}
