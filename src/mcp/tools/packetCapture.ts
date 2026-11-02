import { z } from "zod";
import type { DiagnosticExecutor } from "../../diagnostics/executor.js";
import { buildJsonToolResult } from "../toolResult.js";

export const packetCaptureInputSchema = z.object({
  target: z.string().min(1).describe("Inventory host or group to capture on; every resolved host needs packet capture permission"),
  interface: z.string().min(1)
    .describe("Full EOS interface name (Ethernet, Management, Loopback, Port-Channel, Vlan, Tunnel, or Vxlan, e.g. Ethernet1, Ethernet1/1, Port-Channel10.100, Management0), or any. No abbreviations"),
  vrf: z.string().min(1).optional().describe("VRF to capture in; only with interface any"),
  filter: z.string().min(1).optional()
    .describe("pcap-filter expression selecting the packets to keep, e.g. \"tcp port 179 and host 10.0.0.2\"; up to 4096 characters, no control characters"),
  packet_count: z.number().int().positive().optional()
    .describe("Packets to capture before returning, bounded by diagnostics.maxCapturePacketCount; defaults to diagnostics.defaultCapturePacketCount"),
  window_seconds: z.number().int().positive().optional()
    .describe("Longest time to wait for packet_count packets, bounded by diagnostics.maxCaptureWindowSeconds; defaults to diagnostics.defaultCaptureWindowSeconds")
}).strict("Unrecognized field. eos_packet_capture accepts target, interface, vrf, filter, packet_count, and window_seconds");

export async function buildPacketCaptureToolResult(
  args: z.infer<typeof packetCaptureInputSchema>,
  executor: DiagnosticExecutor,
  signal?: AbortSignal
) {
  const payload = await executor.execute({
    target: args.target,
    request: {
      kind: "packet_capture",
      interface: args.interface,
      ...(args.vrf === undefined ? {} : { vrf: args.vrf }),
      ...(args.filter === undefined ? {} : { filter: args.filter }),
      ...(args.packet_count === undefined ? {} : { packet_count: args.packet_count }),
      ...(args.window_seconds === undefined ? {} : { window_seconds: args.window_seconds })
    },
    ...(signal === undefined ? {} : { signal })
  });
  return buildJsonToolResult(payload);
}
