import { describe, expect, it } from "vitest";
import { diagnosticsConfigSchema } from "../src/config/diagnostics.js";
import { pingDiagnostic, buildPingCommand, parsePingOutput, preparePing } from "../src/diagnostics/ping.js";

const settings = diagnosticsConfigSchema.parse({});

export function pingOutput(sent = 3, received = sent): string {
  return `PING 127.0.0.1 (127.0.0.1) 36(64) bytes of data.\n\n--- 127.0.0.1 ping statistics ---\n${sent} packets transmitted, ${received} received, ${100 * (sent - received) / sent}% packet loss, time 2000ms\n${received > 0 ? "rtt min/avg/max/mdev = 0.020/0.025/0.030/0.001 ms\n" : ""}`;
}

describe("ping validation and command compilation", () => {
  it.each(["127.0.0.1", "192.0.2.1", "::1", "2001:db8::1", "::ffff:192.0.2.1"])("accepts unicast literal %s", (destination) => {
    expect(preparePing({ kind: "ping", destination }, settings).count).toBe(3);
  });

  it.each([
    "127.1", "10.1.1", "127.0.0.1;show version", "127.0.0.1\n", "0.0.0.0", "0.1.2.3", "224.0.0.1", "239.1.1.1", "255.255.255.255",
    "::", "ff02::1", "fe80::1", "febf::1", "fe80::1%eth1", "::ffff:224.0.0.1", "::ffff:ffff:ffff", "::ffff:0.0.0.0"
  ])("rejects unsafe/unsupported literal %s", (destination) => {
    expect(() => preparePing({ kind: "ping", destination }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
  });

  it.each([
    "example.com repeat 5", "a_b.com", "-leaf.example.com", "leaf-.example.com", "a..b", ".example.com", "..", "", "x".repeat(64) + ".com",
    `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`, "exa;mple.com", "example.com\n", "exämple.com", "[::1]"
  ])("rejects invalid host name %j", (destination) => {
    expect(() => preparePing({ kind: "ping", destination }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
  });

  // EOS hands names to glibc, which reads these as IPv4 (0x7f000001 traced to 127.0.0.1 on cEOS 4.34.3M),
  // so they would otherwise bypass the literal restrictions, as 0xe0000001 (224.0.0.1) would.
  it.each(["0x7f000001", "0x7f.1", "0x7f.0.0.1", "0xe0000001", "0XE0.0.0.1", "0x7f.0.0.1.", "0x", "1.0x2.3"])(
    "rejects legacy numeric IPv4 form %j instead of treating it as a name", (destination) => {
      expect(() => preparePing({ kind: "ping", destination }, settings))
        .toThrow(expect.objectContaining({ code: "diagnostic_address_invalid", message: expect.stringContaining("dotted-decimal") }));
    });

  it.each(["deadbeef", "0xcafe.example.com", "1.2.3.4.example", "a0x1"])("still accepts host name %s that only looks numeric in part", (destination) => {
    expect(preparePing({ kind: "ping", destination }, settings).addressFamily).toBe(4);
  });

  it.each(["leaf1", "example.com", "example.com.", "Leaf-1.Example.COM", "a1", "x".repeat(63) + ".com", `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`])(
    "accepts host name %s without applying address restrictions", (destination) => {
      expect(preparePing({ kind: "ping", destination }, settings).addressFamily).toBe(4);
    });

  it("accepts a 253-character name and rejects 254", () => {
    const name = (length: number) => `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(length - 192)}`;
    expect(name(253)).toHaveLength(253);
    expect(() => preparePing({ kind: "ping", destination: name(253) }, settings)).not.toThrow();
    expect(() => preparePing({ kind: "ping", destination: name(254) }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
    expect(() => preparePing({ kind: "ping", destination: `${name(253)}.` }, settings)).not.toThrow();
  });

  it("selects the command family for names from source, address_family, else IPv4", () => {
    const command = (request: Parameters<typeof preparePing>[0]) => buildPingCommand(preparePing(request, settings));
    expect(command({ kind: "ping", destination: "example.com" })).toMatch(/^ping ip example\.com /);
    expect(command({ kind: "ping", destination: "example.com", address_family: "ipv6" })).toMatch(/^ping ipv6 example\.com /);
    expect(command({ kind: "ping", destination: "example.com", address_family: "ipv4" })).toMatch(/^ping ip example\.com /);
    expect(command({ kind: "ping", destination: "example.com", source: "2001:db8::1" })).toMatch(/^ping ipv6 example\.com source 2001:db8::1 /);
    expect(command({ kind: "ping", destination: "example.com", source: "2001:db8::1", address_family: "ipv6" })).toMatch(/^ping ipv6 /);
    expect(command({ kind: "ping", destination: "::1", address_family: "ipv4" })).toMatch(/^ping ipv6 ::1 /);
  });

  it("rejects an address_family that contradicts source", () => {
    expect(() => preparePing({ kind: "ping", destination: "example.com", source: "192.0.2.1", address_family: "ipv6" }, settings))
      .toThrow(expect.objectContaining({ code: "diagnostic_address_family_conflict" }));
  });

  it("still requires a literal source of the destination's family", () => {
    expect(() => preparePing({ kind: "ping", destination: "example.com", source: "leaf1" }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_address_invalid" }));
    expect(() => preparePing({ kind: "ping", destination: "2001:db8::1", source: "192.0.2.1" }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_source_invalid" }));
  });

  it.each([
    [["Example.com", "example.COM"]], [["example.com", "example.com."]], [["127.0.0.1", "127.0.0.1"]], [["::1", "0:0:0:0:0:0:0:1"]]
  ])("rejects duplicates %j", (destinations) => {
    expect(() => pingDiagnostic.prepare({ kind: "ping", destinations }, settings)).toThrow(expect.objectContaining({ code: "diagnostic_destination_duplicate" }));
  });

  it("treats different names, and a name and a literal, as distinct", () => {
    expect(pingDiagnostic.prepare({ kind: "ping", destinations: ["localhost", "127.0.0.1", "localhost.localdomain"] }, settings).executions).toHaveLength(3);
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
    ["PING 10.255.0.4 (10.255.0.4) from 10.255.0.3 : 72(100) bytes of data.", "10.255.0.4"],
    ["PING localhost.localdomain (127.0.0.1) 72(100) bytes of data.", "127.0.0.1"],
    ["PING ::1(::1) 52 data bytes", "::1"],
    ["PING example.com(example.com (2001:db8::1)) 52 data bytes", "2001:db8::1"],
    ["PING 2001:db8::1(2001:db8::1) from 2001:db8::2 : 52 data bytes", "2001:db8::1"]
  ])("reports the resolved address from header %s", (header, address) => {
    const output = pingOutput().replace(/^PING [^\n]*/, header);
    expect(parsePingOutput(output, 3).resolved_address).toBe(address);
  });

  it.each(["PING example.com (not-an-ip) 72(100) bytes of data.", "PING example.com 72(100) bytes of data.", "PING example.com (999.1.1.1) 72(100) bytes of data."])(
    "rejects an unrecognized header %s", (header) => {
      expect(() => parsePingOutput(pingOutput().replace(/^PING [^\n]*/, header), 3)).toThrow(expect.objectContaining({ code: "diagnostic_output_unrecognized" }));
    });

  it("rejects output without a header", () => {
    expect(() => parsePingOutput(pingOutput().replace(/^PING [^\n]*\n/, ""), 3)).toThrow(expect.objectContaining({ code: "diagnostic_output_unrecognized" }));
  });

  it("classifies a name that does not resolve as an execution failure", () => {
    expect(() => parsePingOutput("ping: nosuch.invalid: Name or service not known\n", 3)).toThrow(expect.objectContaining({ code: "diagnostic_destination_unresolved" }));
  });

  it("suggests address_family when the name has no address of the requested family", () => {
    expect(() => parsePingOutput("ping: localhost: Address family for hostname not supported\n", 3))
      .toThrow(expect.objectContaining({ code: "diagnostic_destination_unresolved", message: expect.stringContaining("address_family") }));
  });

  it.each(["ping: connect: Network is unreachable\n", "ping6: connect: Network is unreachable\r\n"])("classifies %j as no route", (output) => {
    expect(() => parsePingOutput(output, 3)).toThrow(expect.objectContaining({ code: "diagnostic_destination_no_route" }));
  });

  it("still reports other ping errors as generic command failures", () => {
    expect(() => parsePingOutput("ping: bind: Cannot assign requested address\n", 3)).toThrow(expect.objectContaining({ code: "diagnostic_command_failed" }));
  });

  it.each([
    "", "ping: bind: Cannot assign requested address\n", "% VRF does not exist\n",
    pingOutput(1), pingOutput(3, 4), pingOutput() + pingOutput(),
    pingOutput().replace("0% packet loss", "100% packet loss"),
    pingOutput().replace("0.020/0.025/0.030", "0.030/0.025/0.020"),
    pingOutput().replace("0.020/0.025/0.030", "unknown")
  ])("fails explicitly rather than inventing a finding (%s)", (output) => {
    expect(() => parsePingOutput(output, 3)).toThrow();
  });
});
