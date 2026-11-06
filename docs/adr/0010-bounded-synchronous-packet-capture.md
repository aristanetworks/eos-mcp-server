# Capture control-plane packets in one bounded, synchronous call

**Status: accepted; implemented and verified on cEOS 4.34.3M. Hardware qualification is tracked in #30.**

The device time limit now applies to every kind: on 2026-11-03 a ping stopped by `runCmds.requestTimeout` returned the same reply on cEOS 4.34.3M with no ping process left, so it also frees its slot at once, as a `ping_device_time_limit_reached` failure rather than a finding. The per-device capture limit is declared by the capture definition, and the capacity snapshot reports per-kind counts under each host's `kinds` instead of `capture_*` fields.

Makes the packet-capture decision that [ADR 0001](0001-non-configuring-diagnostics.md) deferred (privilege, transport, lifecycle and data handling), gives capture its own lifecycle as [ADR 0006](0006-in-memory-timed-diagnostic-capacity.md) required, and makes the annotation decision [ADR 0008](0008-read-only-tool-annotations.md) withheld from it. Admission builds on [ADR 0009](0009-shared-per-device-eapi-slots.md). Tracks issue #17.

The goal is to let an LLM answer questions such as "are BGP keepalives from 10.0.0.2 reaching leaf1?" by reading decoded packets in the tool result, with filters as flexible as pcap-filter syntax allows. Producing pcap files for humans is out of scope.

## What EOS does

Measured on 2026-11-02 against the cEOS 4.34.3M lab, running the CLI `tcpdump` command through text-mode eAPI:

- `tcpdump [interface INTF | interface any [vrf V] | ...] [packet-count N] [size S] [file F] [verbose] [lookup-names] ... [filter FILTER]`. Nothing is mandatory; without `interface` it captures on `fabric`. `packet-count` accepts 1 to 10000. `vrf` is accepted only after `interface any` (or `Fwd<n>`).
- With `packet-count`, the command returns as soon as the count is reached. Output is numeric (`-n`), one line per packet with the link-layer header, and timestamps without a date.
- **When `runCmds.requestTimeout` fires before the count is reached, eAPI returns RPC error 1001 ("unexpected error 408", "Command exceeded its allowed time limit") and none of the packets already captured.** The tcpdump process is gone immediately afterwards.
- Without `requestTimeout`, a capture whose client disconnected kept running for over 70 s and kept holding one of the device's three eAPI slots until it was killed. With the timer, it ended on schedule after the client left.
- `filter` consumes the rest of the line and reaches tcpdump as one argv element; no shell is involved. Pipes, redirects, `;`, newlines and later keywords all became filter text and failed BPF parsing. EOS rejects filters that start with `-` and quoted filters. It does **not** check BPF syntax: an invalid filter returns success with empty output, because tcpdump's error goes to stderr, which eAPI drops. Filters of about 16,000 characters were accepted.
- `file` writes a pcap to flash, and its completions include `flash:startup-config`. No option dumps payload as hex or ASCII.
- Each running capture holds one eAPI slot: with three running, `show version` waited about 7 s.
- `tcpdump` ran at privilege level 1 without `enable` on 4.34.3M. The EOS 4.19.0F manual lists it as Privileged EXEC.

The EOS manual says tcpdump sees only traffic sent or received by the switch's control plane. Seeing hardware-forwarded transit traffic always requires configuration (`monitor session ... destination cpu`, `queue-monitor ... mirror destination cpu`). On cEOS, front-panel ports are veths and the `fabric` default did not see front-panel traffic, so these results do not fully carry over to hardware.

## Decision

Add `eos_packet_capture`, a **Packet Capture** diagnostic run through the existing diagnostic executor:

- **Control plane only.** Captures observe traffic sent or received by the device's CPU. The server never configures mirroring; ADR 0001's prohibition on configuration stands. The tool description says that a capture cannot see hardware-forwarded transit traffic.
- **Bounded and synchronous.** One call runs `tcpdump` until it has `packet_count` packets or `window_seconds` pass, and nothing outlives the call. There are no capture sessions, no start/poll/stop calls and no device files.
- **Complete or unfilled.** A capture that reaches its count yields a complete **Capture Finding** carrying the packets. One stopped by the device timer yields an unfilled finding carrying none: it says fewer matching packets arrived than requested, not that none arrived. An unfilled finding is a successful execution, as an unreachable ping is. There are no automatic retries. The tool description advises a small `packet_count` to test whether traffic is arriving, and a larger one only for busy flows.
- **Permission ladder.** A new inventory variable, `mcp_packet_capture_allowed`, is denied by default and inherited like `mcp_diagnostics_allowed`. Capture also requires **Diagnostic Permission**, so read ⊂ diagnostic ⊂ capture, and `mcp_read_allowed: false` or a missing diagnostic opt-in denies capture. A group containing any host without capture permission is rejected before dispatch, as for ping.
- **Raw filters.** `filter` is an optional pcap-filter expression of up to 4096 characters, without control characters. The server always places it last in the command, so it cannot introduce other keywords. A successful response with empty output can only mean tcpdump exited before capturing, so it is an execution failure, `packet_capture_filter_rejected`, whose message says the filter was probably invalid or the interface could not be captured on. It is never reported as an unfilled finding.
- **Interface required.** `interface` is an EOS interface name whose type is Ethernet, Management, Loopback, Port-Channel, Vlan, Tunnel or Vxlan, or the literal `any`. Only `any` accepts an optional `vrf`. The implicit `fabric` default is not offered, because what it sees differs between hardware and cEOS.
- **Fixed command shape.** Each execution is a text-mode eAPI request containing `enable`, then `tcpdump interface <INTF> [vrf <VRF>] packet-count <N> filter <FILTER>`. The server never emits `file`, `size`, `max-file-size`, `filecount`, `monitor`, `queue-monitor`, `interface-address`, `verbose` or `lookup-names`. It sends `enable` although 4.34.3M does not need it, because older releases document `tcpdump` as privileged and the ladder already requires a credential that can enable for ping.
- **Default decode only.** `verbose` is not exposed. Payload can leave the device only through `file`, which is never sent.
- **Mandatory device timer.** Every capture sends `runCmds.requestTimeout` equal to its window, whatever `diagnostics.nativeRequestTimeout` says; that setting stays ping's escape hatch. On an EOS version that rejects the field, captures fail rather than run without an end.
- **Admission.** A capture takes a diagnostic slot from the shared per-device eAPI slots of ADR 0009, and at most `diagnostics.captureDeviceConcurrency` (default 1) captures run on one device at a time. With default settings, one capture, one ping and one read can run on a device together.
- **Completion and uncertainty.** A correlated RPC error 1001 in which `enable` succeeded and tcpdump's own result is EOS's "Command exceeded its allowed time limit" (408) is confirmed completion with an unfilled finding, and frees the slot at once; for a capture it is the expected end, unlike for ping. Any other post-dispatch error, HTTP timeout, transport loss or cancellation is uncertain, as in ADR 0006, but holds the slot for that execution's own window plus a 2 s margin rather than `commandTimeoutMs`, since the device timer ends the capture by then.
- **Group targets.** A group runs one capture per resolved host concurrently, with the same interface, VRF and filter. A host where the interface does not exist fails on its own entry. `hosts × packet_count` must not exceed `diagnostics.maxCapturePacketsPerRequest`; `maxResponseSizeBytes` still applies.
- **Results.** Each host's finding has `kind: "packet_capture"`, `capture: "complete" | "unfilled"`, `requested_packet_count`, `window_seconds`, and `packets`: the verbatim tcpdump lines, one per packet. The server does not parse protocols, so there is no `include_raw`.
- **Annotations.** `readOnlyHint: true`, because a capture writes no files and changes no configuration, and running captures on both ends of a link at once needs clients to overlap calls. `openWorldHint: false`, because a capture only reaches inventory devices. The server-side permission is the control; ADR 0008 already holds that annotations are not a safety mechanism.

New `diagnostics` settings, reported under `limits.diagnostics` in server info:

| Setting | Default |
| --- | --- |
| `defaultCapturePacketCount` | 10 |
| `maxCapturePacketCount` | 1000 |
| `defaultCaptureWindowSeconds` | 10 |
| `maxCaptureWindowSeconds` | 60 |
| `maxCapturePacketsPerRequest` | 2000 |
| `captureDeviceConcurrency` | 1, must not exceed `deviceConcurrency` |
| `captureOverallOperationTimeoutMs` | 90000, must exceed `maxCaptureWindowSeconds` |

## Consequences

- An unfilled capture discards the packets that did arrive. The device offers no way to keep them without writing a file.
- On hardware, a capture on a front-panel interface sees only control-plane traffic, so an unfilled finding can mean the traffic was forwarded in hardware rather than absent.
- Default tcpdump decode can still print cleartext secrets, such as SNMPv1/v2c community strings and TCP-MD5 digest bytes. Documentation for `mcp_packet_capture_allowed` must say so.
- A capture on `Management` or `any` without a filter includes the server's own eAPI traffic.
- One capture per device means a second capture to the same device queues for up to a window, and can hit the overall deadline.
- Everything above was measured on cEOS 4.34.3M only. Interface naming, the `Cpu` interface (unsupported on cEOS), `fabric` behaviour, and whether the 408 behaviour and stderr loss carry over must be checked on hardware before the tool is called qualified there.

## Alternatives considered

- **Capture sessions (start, poll, stop).** They would keep packets past a window, but need the session registry, orphan cleanup and restart handling that ADR 0006 removed from ping.
- **Writing a pcap to flash.** Changes device state, uses flash, needs cleanup and a transfer path, and the same `file` keyword can name `flash:startup-config`.
- **Temporary mirroring to the CPU.** The only way to see transit traffic, but it is configuration.
- **Automatic retries with a smaller count after an unfilled capture.** Breaks the no-retry rule and makes the time budget unpredictable.
- **Structured filter fields compiled to BPF.** Safer-looking, but always less expressive than pcap-filter syntax, which LLMs write fluently. Injection is not a risk because the filter reaches tcpdump as one argument.
- **Parsing packets into fields.** Loses information for any protocol the parser does not handle.
- **Treating the 408 timeout as uncertain, as ping does.** Every unfilled capture, the most common outcome, would hold its device's single capture slot for another window.
- **Omitting `enable`.** Works on 4.34.3M but fails on releases where `tcpdump` is privileged, and saves no privilege because the ladder already implies ping.

**Update (0.12):** `mcp_packet_capture_allowed` now defaults to `true`; set it to `false` to deny capture. The ladder and whole-group rejection are unchanged.
