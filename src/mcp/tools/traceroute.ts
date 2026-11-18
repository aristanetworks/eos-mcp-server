import { z } from "zod";
import type { DiagnosticExecutor } from "../../diagnostics/executor.js";
import { buildJsonToolResult } from "../toolResult.js";

export const tracerouteInputSchema = z.object({
  target: z.string().min(1).describe("Inventory host or group executing the diagnostic"),
  destinations: z.array(z.string().min(1)).min(1)
    .describe("Unique unicast IPv4/IPv6 literals or DNS host names to trace to from every target host; need not be in inventory. Names are resolved by each executing device's own resolver, not by this server, and each result reports the resolved_address. Use one entry for a single trace. Bounded by diagnostics.maxTracerouteDestinationsPerRequest"),
  vrf: z.string().min(1).optional().describe("Explicit VRF for every destination; omission uses the EOS default"),
  source: z.string().min(1).optional().describe("Source IP literal in the same address family as every destination; name destinations take its family. Set it to a loopback address when tracing between loopbacks"),
  address_family: z.enum(["ipv4", "ipv6"]).optional().describe("Address family used to resolve name destinations on the device; literals keep their own family. Defaults to the source's family, else ipv4; must not contradict source"),
  include_raw: z.boolean().default(false)
}).strict("Unrecognized field. eos_traceroute accepts target, destinations, vrf, source, address_family, and include_raw; use destinations: [\"<ip or name>\"] for a single trace");

export async function buildTracerouteToolResult(
  args: z.infer<typeof tracerouteInputSchema>,
  executor: DiagnosticExecutor,
  signal?: AbortSignal
) {
  const payload = await executor.execute({
    target: args.target,
    request: {
      kind: "traceroute",
      destinations: args.destinations,
      ...(args.vrf === undefined ? {} : { vrf: args.vrf }),
      ...(args.source === undefined ? {} : { source: args.source }),
      ...(args.address_family === undefined ? {} : { address_family: args.address_family })
    },
    includeRaw: args.include_raw,
    ...(signal === undefined ? {} : { signal })
  });
  return buildJsonToolResult(payload);
}
