import { describe, expect, it } from "vitest";
import { diagnosticsConfigSchema } from "../src/config/diagnostics.js";
import { buildPacketCaptureCommand, interpretPacketCaptureOutput, packetCaptureDiagnostic, preparePacketCapture } from "../src/diagnostics/packetCapture.js";

const settings = diagnosticsConfigSchema.parse({});

// Recorded from cEOS 4.34.3M: `tcpdump interface Ethernet1 packet-count 2 filter icmp` during a ping from the neighbor.
const capturedPackets = [
  "22:06:07.386059 aa:c1:ab:ef:f8:0a > aa:c1:ab:eb:7a:d8, ethertype IPv4 (0x0800), length 114: 10.255.255.1 > 10.255.255.0: ICMP echo request, id 60673, seq 1, length 80",
  "22:06:07.386088 aa:c1:ab:eb:7a:d8 > aa:c1:ab:ef:f8:0a, ethertype IPv4 (0x0800), length 114: 10.255.255.0 > 10.255.255.1: ICMP echo reply, id 60673, seq 1, length 80"
];

describe("packet capture validation and command compilation", () => {
  it("captures the default packet count on the requested interface", () => {
    expect(buildPacketCaptureCommand(preparePacketCapture({ kind: "packet_capture", interface: "Ethernet1" }, settings)))
      .toBe("tcpdump interface Ethernet1 packet-count 10");
  });

  it("places the VRF after interface any and the filter verbatim at the end", () => {
    const request = { kind: "packet_capture" as const, interface: "any", vrf: "MGMT", filter: "tcp port 179 and host 10.0.0.2", packet_count: 5 };
    expect(buildPacketCaptureCommand(preparePacketCapture(request, settings)))
      .toBe("tcpdump interface any vrf MGMT packet-count 5 filter tcp port 179 and host 10.0.0.2");
  });

  it("keeps keyword-like filter text inside the filter, which EOS reads to the end of the line", () => {
    const command = buildPacketCaptureCommand(preparePacketCapture(
      { kind: "packet_capture", interface: "Management0", filter: "icmp file flash:startup-config verbose" }, settings));
    expect(command).toBe("tcpdump interface Management0 packet-count 10 filter icmp file flash:startup-config verbose");
  });

  it.each([
    "Ethernet1", "Ethernet1/1", "Ethernet1/1/1", "Ethernet1.100", "Ethernet1/1.100", "Management0", "Management1/1", "Loopback0",
    "Port-Channel10", "Port-Channel10.100", "Vlan11", "Tunnel0", "Vxlan1", "any"
  ])("accepts interface %s", (interfaceName) => {
    expect(preparePacketCapture({ kind: "packet_capture", interface: interfaceName }, settings).interface).toBe(interfaceName);
  });

  it.each([
    "", "Et1", "eth1", "ethernet1", "Ma0", "Po10", "fabric", "Cpu", "Fwd0", "Any", "ANY", "Ethernet", "Ethernet1 ", " Ethernet1",
    "Ethernet1 filter icmp", "Ethernet1;reload", "Ethernet1\nshow version", "Ethernet1/1/1/1", "Ethernet1.100.1", "Loopback0.1",
    "Vlan11/1", "Recirc-Channel1", "Management0 vrf MGMT"
  ])("rejects interface %j before dispatch", (interfaceName) => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: interfaceName }, settings))
      .toThrow(expect.objectContaining({ code: "packet_capture_interface_invalid" }));
  });

  it("accepts a VRF only with interface any", () => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: "Management0", vrf: "MGMT" }, settings))
      .toThrow(expect.objectContaining({ code: "packet_capture_vrf_requires_any" }));
  });

  it.each(["x;reload", "x\nshow version", "x y", "-x", "x|cat", "x".repeat(65)])("rejects unsafe VRF %j as ping does", (vrf) => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: "any", vrf }, settings))
      .toThrow(expect.objectContaining({ code: "diagnostic_vrf_invalid" }));
  });

  it("accepts a filter of up to 4096 characters", () => {
    const filter = `host ${"1".repeat(4091)}`;
    expect(preparePacketCapture({ kind: "packet_capture", interface: "any", filter }, settings).filter).toBe(filter);
  });

  it.each([
    { label: "over 4096 characters", filter: "x".repeat(4097) },
    { label: "empty", filter: "" },
    { label: "blank", filter: "   " },
    { label: "newline", filter: "icmp\nshow version" },
    { label: "carriage return", filter: "icmp\rshow version" },
    { label: "tab", filter: "icmp\tor arp" },
    { label: "NUL", filter: "icmp\u0000" },
    { label: "DEL", filter: "icmp\u007f" },
    { label: "escape", filter: "icmp\u001b[2J" }
  ])("rejects a $label filter before dispatch", ({ filter }) => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: "any", filter }, settings))
      .toThrow(expect.objectContaining({ code: "packet_capture_filter_invalid" }));
  });

  it("uses configured defaults and accepts values up to the ceilings", () => {
    const configured = diagnosticsConfigSchema.parse({ defaultCapturePacketCount: 3, defaultCaptureWindowSeconds: 4 });
    expect(preparePacketCapture({ kind: "packet_capture", interface: "any" }, configured)).toMatchObject({ packet_count: 3, window_seconds: 4 });
    expect(preparePacketCapture({ kind: "packet_capture", interface: "any", packet_count: 1000, window_seconds: 60 }, settings))
      .toMatchObject({ packet_count: 1000, window_seconds: 60 });
  });

  it.each([0, -1, 1.5, 1001, NaN, Infinity])("rejects packet count %s", (packetCount) => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: "any", packet_count: packetCount }, settings))
      .toThrow(expect.objectContaining({ code: "packet_capture_count_invalid" }));
  });

  it.each([0, -1, 1.5, 61, NaN, Infinity])("rejects window %s seconds", (windowSeconds) => {
    expect(() => preparePacketCapture({ kind: "packet_capture", interface: "any", window_seconds: windowSeconds }, settings))
      .toThrow(expect.objectContaining({ code: "packet_capture_window_invalid" }));
  });
});

describe("packet capture output interpretation", () => {
  const capture = preparePacketCapture({ kind: "packet_capture", interface: "Ethernet1", filter: "icmp", packet_count: 2, window_seconds: 5 }, settings);

  it("reports a complete capture carrying each packet line verbatim", () => {
    expect(interpretPacketCaptureOutput(`${capturedPackets.join("\n")}\n`, capture)).toEqual({
      kind: "packet_capture",
      capture: "complete",
      requested_packet_count: 2,
      window_seconds: 5,
      packets: capturedPackets
    });
  });

  it("drops line terminators and blank lines but nothing else", () => {
    expect(interpretPacketCaptureOutput(`\r\n${capturedPackets.join("\r\n")}\r\n\r\n`, capture).packets).toEqual(capturedPackets);
  });

  // Measured on cEOS 4.34.3M: tcpdump rejects `notaproto foo bar` on stderr, which eAPI drops, and eAPI answers success with "".
  it.each(["", "\n", " \r\n\t"])("fails empty output as a filter the device rejected, naming both likely causes (%j)", (output) => {
    expect(() => interpretPacketCaptureOutput(output, capture)).toThrow(expect.objectContaining({
      code: "packet_capture_filter_rejected",
      message: expect.stringMatching(/pcap-filter.*interface Ethernet1|interface Ethernet1.*pcap-filter/s)
    }));
  });

  it("reports an unfilled capture carrying no packets when the device time limit ended it", () => {
    expect(packetCaptureDiagnostic.interpret({ kind: "packet_capture", deviceTimeLimitReached: true }, capture)).toEqual({
      kind: "packet_capture",
      capture: "unfilled",
      requested_packet_count: 2,
      window_seconds: 5,
      packets: []
    });
  });

  it("interprets packets in a successful response as a complete capture", () => {
    expect(packetCaptureDiagnostic.interpret({ kind: "packet_capture", output: `${capturedPackets.join("\n")}\n` }, capture))
      .toMatchObject({ capture: "complete", packets: capturedPackets });
  });
});
