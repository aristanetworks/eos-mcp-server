import { describe, expect, it } from "vitest";
import { diagnosticsConfigSchema } from "../src/config/diagnostics.js";
import { buildPingCommand, parsePingOutput, preparePing } from "../src/diagnostics/ping.js";

const settings = diagnosticsConfigSchema.parse({});

export function pingOutput(sent = 3, received = sent): string {
  return `PING 127.0.0.1 (127.0.0.1) 36(64) bytes of data.\n\n--- 127.0.0.1 ping statistics ---\n${sent} packets transmitted, ${received} received, ${100 * (sent - received) / sent}% packet loss, time 2000ms\n${received > 0 ? "rtt min/avg/max/mdev = 0.020/0.025/0.030/0.001 ms\n" : ""}`;
}

describe("ping validation and command compilation", () => {
  it.each(["127.0.0.1", "192.0.2.1", "::1", "2001:db8::1", "::ffff:192.0.2.1"])("accepts unicast literal %s", (destination) => {
    expect(preparePing({ kind: "ping", destination }, settings).count).toBe(3);
  });

  it.each([
    "leaf1", "example.com", "127.1", "127.0.0.1;show version", "127.0.0.1\n", "0.0.0.0", "0.1.2.3", "224.0.0.1", "239.1.1.1", "255.255.255.255",
    "::", "ff02::1", "fe80::1", "febf::1", "fe80::1%eth1", "::ffff:224.0.0.1", "::ffff:ffff:ffff", "::ffff:0.0.0.0"
  ])("rejects unsafe/unsupported literal %s", (destination) => {
    expect(() => preparePing({ kind: "ping", destination }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
  });

  it.each([0, -1, 1.5, 11, NaN, Infinity])("rejects invalid packet count %s", (count) => {
    expect(() => preparePing({ kind: "ping", destination: "127.0.0.1", count }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_count_invalid" }));
  });

  it.each(["x;reload", "x\nshow version", "x y", "-x", "x|cat", "x$(id)", "x".repeat(65)])("rejects unsafe VRF %s", (vrf) => {
    expect(() => preparePing({ kind: "ping", destination: "::1", vrf }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_vrf_invalid" }));
  });

  it("rejects source address injection and family mismatches", () => {
    expect(() => preparePing({ kind: "ping", destination: "::1", source: "127.0.0.1" }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_source_invalid" }));
    expect(() => preparePing({ kind: "ping", destination: "::1", source: "::1 source x" }, settings)).toThrow();
  });

  it("builds explicit bounded IPv4/IPv6 commands with fixed pacing and size", () => {
    expect(buildPingCommand(preparePing({ kind: "ping", destination: "127.0.0.1" }, settings)))
      .toBe("ping ip 127.0.0.1 repeat 3 timeout 1 interval 1 size 64");
    expect(buildPingCommand(preparePing({ kind: "ping", destination: "::1", vrf: "default", source: "::1", count: 2 }, settings)))
      .toBe("ping vrf default ipv6 ::1 source ::1 repeat 2 timeout 1 interval 1 size 64");
  });

  it("uses configured defaults and reply timeout", () => {
    const configured = diagnosticsConfigSchema.parse({ defaultPingCount: 2, pingReplyTimeoutMs: 2000, commandTimeoutMs: 40_000, httpTimeoutMs: 45_000 });
    expect(buildPingCommand(preparePing({ kind: "ping", destination: "::1" }, configured)))
      .toContain("repeat 2 timeout 2 interval 1 size 64");
  });
});

describe("ping output interpretation", () => {
  it.each([[3, "reachable"], [1, "partial"], [0, "unreachable"]])("reports %s replies as %s without failing execution", (received, reachability) => {
    const finding = parsePingOutput(pingOutput(3, Number(received)), 3);
    expect(finding.reachability).toBe(reachability);
    expect(finding.packets_sent).toBe(3);
    expect(finding.packets_received).toBe(received);
    expect(finding.rtt_ms).toEqual(received ? { min: 0.020, avg: 0.025, max: 0.030 } : null);
  });

  it("accepts CRLF summaries without changing their interpretation", () => {
    expect(parsePingOutput(pingOutput().replaceAll("\n", "\r\n"), 3).reachability).toBe("reachable");
  });

  it("does not invent RTT when no timing is present", () => {
    expect(parsePingOutput(pingOutput().split("rtt")[0] ?? "", 3).rtt_ms).toBeNull();
  });

  it.each([
    "", "ping: connect: Network is unreachable\n", "ping: bind: Cannot assign requested address\n", "% VRF does not exist\n",
    pingOutput(1), pingOutput(3, 4), pingOutput() + pingOutput(),
    pingOutput().replace("0% packet loss", "100% packet loss"),
    pingOutput().replace("0.020/0.025/0.030", "0.030/0.025/0.020"),
    pingOutput().replace("0.020/0.025/0.030", "unknown")
  ])("fails explicitly rather than inventing a finding (%s)", (output) => {
    expect(() => parsePingOutput(output, 3)).toThrow();
  });
});
