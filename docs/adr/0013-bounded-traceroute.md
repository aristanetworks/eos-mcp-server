# Run traceroute as a fixed-shape diagnostic with its own timer and budget

**Status: accepted; implemented and verified on cEOS 4.34.3M.** Makes the traceroute decision that [ADR 0001](0001-non-configuring-diagnostics.md) deferred and gives it its own lifecycle, as [ADR 0006](0006-in-memory-timed-diagnostic-capacity.md) requires for diagnostics that differ from ping. Builds on [ADR 0012](0012-dns-name-destinations.md) for Destinations and on [ADR 0005](0005-multi-destination-ping.md) for fan-out.

## What EOS does

Measured on 2026-11-18 against cEOS 4.34.3M through text-mode eAPI:

- The only syntax is `traceroute [vrf V] [ip|ipv6] <dest> [source <addr|intf>] [interface <egress-intf>]`. There are no max-hops, probes-per-hop, wait or numeric options, and Linux flags (`-m 5`, `-n`) are rejected with 1002. Every trace uses 30 hops, 3 probes per hop and 60-byte probes (80 for IPv6). It runs without `enable`.
- An answering path finishes in about 0.1 s. A path that goes silent (`* * *` through hop 30) takes 30.1 s; in the lab's no-source trace only hop 1, the directly connected neighbor, answers.
- With `runCmds.requestTimeout`, EOS returns RPC error 1001 ("unexpected error 408", "Command exceeded its allowed time limit") at the timer, with **none of the hops** already found, and no traceroute process remains.
- Every responding hop address is reverse-resolved. With a name server that never answers, each distinct address costs about 10 s and failed lookups are not cached between runs: a 2-hop trace took 20 s and a 7-hop trace 140 s.
- No route gives `connect: Network is unreachable`; an unresolvable name gives `<name>: Name or service not known`.
- EOS proxies DNS through dnsmasq. After the last `ip name-server` was removed, `show ip name-server` was clean at once, but `/etc/dnsmasq.conf` kept the old upstream for about 20–30 s before EOS regenerated it and stopped dnsmasq. Traces in that window still stalled on reverse lookups.

## Decision

Add `eos_traceroute`, run through the diagnostic executor:

- **Inputs.** `target`, `destinations` (as ping, per ADR 0012), optional `vrf`, `source` (an IP literal), `address_family` (names only), and `include_raw`. No source interface or egress `interface` yet. The tool description tells the LLM to set `source` to a loopback when tracing between loopbacks, since the default source is often an interface address with no return route.
- **Privilege.** The trace is sent without `enable`, since EOS runs it unprivileged, so an EOS role that permits traceroute but denies enable can still trace. Each diagnostic kind declares whether `enable` precedes its command, and the device-timer reply is recognized for the sequence actually sent: one entry for traceroute, a successful `enable` then the command for ping and capture.
- **Permission.** **Diagnostic Permission**, with no new inventory variable. A trace sends at most 90 small probes and reveals only router addresses.
- **Findings.** A completed trace yields a **Path Finding**: `reached` when any response on the last hop came from the **Resolved Address**, whatever marker (`!X`, `!H`, ...) it carried, otherwise `unreached`, always with the hops seen. Arriving and being refused is a different fact from not arriving; the marker keeps it visible. No route and unresolvable names are execution failures per ADR 0012, not unreached findings. Each hop is `{ hop, responses: [{ address, name?, rtt_ms, marker? } | null] }`, with the marker on each response because probes of one hop can carry different markers, so ECMP fan-out and the first silent hop are explicit. The verbatim output is returned only with `include_raw`. Unrecognized output fails with `diagnostic_output_unrecognized` rather than becoming a finding, since the path is judged by the last hop. That includes a responder address that is not a valid IP address, hops not numbered 1, 2, 3, ... up to the header's hop limit, more than three probes on a hop, and a probe time that is not a finite number. IPv6 scopes are kept as printed and compared with the address.
- **Timer and lifecycle.** A new `diagnostics.tracerouteTimeoutMs` (default 45000, just over the 30 s silent-path bound). Every trace sends `runCmds.requestTimeout` equal to it, whatever `nativeRequestTimeout` says, as packet capture does. A dead name server can otherwise keep a trace running for minutes. The Device Time Limit reply is confirmed completion and frees the slot at once, but is a failure, `traceroute_device_time_limit_reached`, whose message names slow reverse DNS on the device as a likely cause. Any other unknown completion holds the slot as uncertain for `tracerouteTimeoutMs`. The HTTP timeout is `tracerouteTimeoutMs + 5000`.
- **Admission.** Traces share `diagnostics.deviceConcurrency` and the ADR 0009 per-device eAPI slots, with no traceroute-specific per-device limit. Load per trace is comparable to a ping, and the reserved read slot keeps reads from starving.
- **Request limits.** `maxTracerouteDestinationsPerRequest` (default 4), `maxTracesPerRequest` (default 16, hosts × destinations) and `tracerouteOverallOperationTimeoutMs` (default 120000, which must exceed `tracerouteTimeoutMs`).
- **Annotations.** `readOnlyHint: true` per ADR 0008, and `openWorldHint: true`, because Destinations need not be in inventory.
- **Lab tests.** Mirror the ping suite: `EOS_TRACEROUTE_TEST_HOST` (default node2-1) tracing to `EOS_TRACEROUTE_TEST_DESTINATION` (default node2-2's Loopback0, 10.255.0.4) with a loopback `source` for a 2-hop answering path, plus a slow-suite-only silent case: the same trace without `source`, so the destination's replies have no return route. Only hop 1 answers and hops 2 to 30 are silent. The DNS-stall behavior stays a manual measurement, because automating it reconfigures the lab.

## Consequences

- On a device whose name servers do not answer, any trace with more than a few responding hops hits the timer and returns nothing. No reasonable budget fixes that, and holding slots for minutes would hurt every other call.
- Two silent traces can hold both diagnostic slots on a device for up to 45 s, delaying pings, not reads.
- Everything above was measured on cEOS 4.34.3M only.

## Alternatives considered

- **`bash traceroute -n` with hop and wait limits.** Fixes reverse DNS and bounds time, but it is the shell fallback ADR 0001 rules out.
- **A much longer timer (120 s or more).** Rescues a few slow lookups at the cost of slots held for minutes, and still fails a dead name server.
- **Refusing to trace when name servers are configured.** Blocks most production devices, whose DNS works.
- **Reusing `commandTimeoutMs`.** At its 30 s default every silent path would hit the timer.
- **A separate per-device traceroute limit of 1.** Four silent destinations would need 180 s on one device.
