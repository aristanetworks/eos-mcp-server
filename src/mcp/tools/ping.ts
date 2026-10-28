import { z } from "zod";
import type { DiagnosticExecutor } from "../../diagnostics/executor.js";
import { AppError } from "../../core/errors.js";
import { buildJsonToolResult } from "../toolResult.js";

export const pingInputSchema = z.object({
  target: z.string().min(1).describe("Inventory host or group executing the diagnostic"),
  destinations: z.array(z.string().min(1)).min(1)
    .describe("Unique unicast IPv4/IPv6 literals to test from every target host; need not be in inventory. Use one entry for a single ping. Bounded by diagnostics.maxDestinationsPerRequest"),
  count: z.number().int().positive().optional().describe("Packet count per destination, bounded by server settings; defaults to diagnostics.defaultPingCount"),
  vrf: z.string().min(1).optional().describe("Explicit VRF for every destination; omission uses the EOS default"),
  source: z.string().min(1).optional().describe("Source IP literal in the same address family as every destination"),
  include_raw: z.boolean().default(false)
}).strict("Unrecognized field. eos_ping accepts target, destinations, count, vrf, source, and include_raw; use destinations: [\"<ip>\"] for a single ping");

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
        destinations: args.destinations,
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
