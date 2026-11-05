# Containerlab troubleshooting demos

Build each demonstration around **find the fault, prove the cause, verify recovery**.

These scenarios use the two-spine, six-leaf fabric in
[`clab/testlab.clab.yaml`](../clab/testlab.clab.yaml) and the server configuration in
[`example-codex`](../example-codex/eos-mcp-server-config.yml).

Stage and restore configuration faults separately. The EOS MCP server performs
inspection and bounded diagnostics; it does not change device configuration.
Capture a healthy baseline before each fault and repeat the same checks after
restoration.

## Verified starting point

Observed on November 4, 2026; recheck before presenting:

- All eight devices responded to MCP show requests.
- All reported IPv4 and EVPN BGP neighbor entries were Established.
- Source-pinned pings from node2-1 to node2-2 succeeded with 3/3 replies in both
  VRF10 and VRF11.
- On node2-1, the route to node2-2's VTEP had two underlay next hops.
- On node2-1, the remote diagnostic loopbacks resolved through Vxlan1 using L3
  VNI 10 for VRF10 and L3 VNI 11 for VRF11.
- VXLAN MAC address tables were empty.

| Test | Source on node2-1 | Destination on node2-2 |
| --- | --- | --- |
| Underlay VTEP reachability | `10.255.1.3` | `10.255.1.4` |
| VRF10 diagnostic loopbacks | `10.255.10.3` | `10.255.10.4` |
| VRF11 diagnostic loopbacks | `10.255.11.3` | `10.255.11.4` |

## 1. Everything still pings, but redundancy is lost

**Stage:** Shut node2-1 Ethernet1, its uplink to node1-1.

**Demo prompt:**

> Check whether node2-1 has lost any redundancy. Verify both expected uplinks
> and BGP neighbors, inspect the route to node2-2's VTEP, and test reachability.
> Explain why successful pings may hide a degraded fabric.

**Evidence to show:**

- Compare both ends of the affected link: node2-1 Ethernet1 and node1-1 Ethernet1.
- Identify the lost underlay BGP neighbor.
- Show the remote VTEP route dropping from two next hops to one while traffic
  continues through node1-2.
- Restore the link and verify both paths return.

**Useful tools:** `eos_run_show`, `eos_ping`, `eos_show_logging`.

**Why it works:** Reachability can remain healthy while resilience is degraded.

## 2. The underlay is healthy, but one tenant is broken

**Stage:** Remove the VRF10 EVPN import route target on node2-1, leaving VRF11
intact.

**Demo prompt:**

> node2-1 can reach node2-2's VTEP, but VRF10 connectivity is failing. Compare
> VRF10 with VRF11 and determine where the route disappears. Check EVPN routes,
> VRF routing tables, route targets, and return routing.

**Evidence to show:**

- Underlay VTEP reachability and EVPN sessions remain healthy.
- The remote VRF10 diagnostic loopback route is absent from the local VRF table.
- Compare EVPN route visibility with route import into the VRF.
- VRF11 provides a working comparison using its own source and destination.
- Restore the import route target, verify the route returns, and repeat the ping.

**Useful tools:** `eos_run_show`, `eos_get_running_config` with a relevant section,
`eos_ping`.

**Why it works:** The investigation must distinguish session health, route
distribution, and forwarding. Existing unique tenant loopbacks support this
routed-overlay scenario without adding Linux hosts.

## 3. The failed ping used the wrong VRF

**Setup:** No configuration fault is needed. Compare the same destination in the
default routing context and VRF10.

**Demo prompt:**

> Investigate reachability from node2-1 to 10.255.10.4. Compare the default
> routing table with VRF10, identify the appropriate source address, and run
> bounded tests in each context.

**Evidence to show:**

- Identify which routing table contains the destination.
- Explain the outcome in the default routing context.
- Explicitly select VRF10 and source 10.255.10.3, then repeat the test.
- Distinguish a test-context error from a network fault.

**Useful tools:** `eos_run_show`, `eos_ping` with explicit `vrf` and `source`.

**Why it works:** A short, repeatable demonstration of diagnosing a misleading
test before changing the network.

## 4. Why does changing the ping source change the result?

**Setup:** No fault injection is needed with the verified routing policy. From
node2-1, ping node2-2's Loopback1 (`10.255.1.4`) in the default VRF, first using
source `10.255.255.1` (Ethernet1), then `10.255.1.3` (Loopback1).

Verified on November 4, 2026:

| Source on node2-1 | Destination | Replies | Return route on node2-2 |
| --- | --- | --- | --- |
| Ethernet1: `10.255.255.1` | `10.255.1.4` | 0/3 | No matching route, including a default |
| Loopback1: `10.255.1.3` | `10.255.1.4` | 3/3 | BGP route to `10.255.1.3/32` |

Recheck before presenting: different outcomes depend on which source prefixes
are advertised. These are underlay ICMP tests.

**Demo prompt:**

> From node2-1, ping 10.255.1.4 in the default VRF with three packets per test:
> first using source 10.255.255.1, then source 10.255.1.3. Explain any difference
> in the results. Check node2-1's route to the destination and node2-2's route
> back to each source, including any default route. Use a bounded ICMP capture
> on node2-2 during a repeat of the failing test to check whether requests
> arrive. Separate observed packet evidence from conclusions inferred from
> routing tables. Do not change configuration.

**Evidence to show:**

- Compare results with the same destination and different explicit sources.
- Show node2-1's route to `10.255.1.4` and node2-2's routes back to
  `10.255.255.1` and `10.255.1.3`.
- Start a capture on node2-2 using interface `any`, filter
  `icmp and src host 10.255.255.1 and dst host 10.255.1.4`, and a packet count
  of one; repeat the failing ping while that capture is active.
- A captured request establishes arrival despite the failed ping. The missing
  return route explains why a reply cannot be routed back to that source.
  If the capture is unfilled, do not claim arrival was proven.
- No configuration repair is needed for this demonstration: using the advertised
  Loopback1 source makes the diagnostic routable in both directions.

**Useful tools:** `eos_run_show`, `eos_ping`, `eos_packet_capture`.

**Why it works:** Packet loss alone cannot identify the failing direction.

## 5. Show BGP on the wire

**Setup:** No configuration fault is needed.

**Demo prompt:**

> Inspect node2-1's BGP neighbor 10.255.255.0 and its negotiated timers. Capture
> one matching BGP packet on Ethernet1, then explain what the decoded packet
> proves about the session.

**Evidence to show:**

- Inspect neighbor state and timers using `show ip bgp neighbors 10.255.255.0`.
- Capture on node2-1 Ethernet1 with filter
  `tcp port 179 and host 10.255.255.0`.
- Request one packet and choose a window based on the observed timers, within
  the server's capture limit.
- Identify whether the returned packet is a KEEPALIVE, another BGP message, or
  a TCP acknowledgment; a port filter alone does not select KEEPALIVEs.

**Useful tools:** `eos_run_show`, `eos_packet_capture`.

**Capture behavior:** The server discards partial captures when the requested
count is not reached. An `unfilled` result does not establish that no matching
traffic arrived. See [Network diagnostics](DIAGNOSTICS.md#packet-capture).

**Why it works:** It connects a high-level diagnosis to observable protocol
traffic.

## 6. Is the switch down, or is management unavailable?

**Stage:** Disable eAPI on one leaf while preserving its data-plane links and
routing. Retain a separate console or management method to restore eAPI.

**Demo prompt:**

> One device is failing MCP requests. Determine whether this is a
> management-access failure or a forwarding outage. Correlate readiness results
> with its neighbors' BGP state and reachability tests from other switches.

**Evidence to show:**

- The target fails direct MCP access.
- Neighboring devices still report Established BGP sessions to that leaf.
- Tests from other switches still reach the affected leaf's loopbacks.
- Restore eAPI and verify readiness returns.

**Useful tools:** `eos_probe_devices`, `eos_run_show`, `eos_ping` from reachable
inventory devices.

**Why it works:** The assistant can investigate across devices even when it
cannot directly query the suspected device. Neighbor sessions and loopback
reachability establish specific connectivity facts; end-to-end transit forwarding
would require an additional traffic test.

## HTML report scenarios

The following scenarios add a shareable visual artifact to the investigation.
The assistant collects evidence through MCP and generates the HTML locally;
HTML report generation is not an EOS MCP tool. These are demo instructions,
not reports from additional measurements already performed.

### Shared report requirements

Include these requirements with each prompt below:

> Generate a single self-contained HTML file with embedded CSS, JavaScript,
> inline SVG charts, and sanitized evidence data. It must open locally without
> a web server, external fonts, libraries, or network requests. Use a polished
> operations-dashboard design: a dark navy header, light content panels, generous
> spacing, clear typography, and consistent teal, amber, and red status accents.
> Include text labels and icons alongside colors. Make the layout responsive,
> keyboard accessible, and readable when printed. Provide labeled chart axes,
> units, legends, sortable detail tables, and expandable evidence panels.
> Show collection start/end times, device scope, source/destination/VRF where
> relevant, and the exact commands behind findings. Keep unavailable data visibly
> unknown, separate tool failures from network findings, and distinguish measured
> facts from explanations. Never invent samples, history, or chart values.
> Omit credentials and redact secrets from configuration excerpts; escape all
> device-derived text before rendering it. Use the output filename specified in
> the scenario and return a clickable link to the generated file.

Prefer visualizations that answer a troubleshooting question. Avoid decorative
health scores or gauges without an explicit, evidence-based definition.

## 7. Fabric health and redundancy dashboard

**Skill:** [eos-fabric-report](../skills/eos-fabric-report/SKILL.md).

**Setup:** Start healthy, or stage the single-uplink fault from scenario 1.

**Demo prompt:**

> Use the EOS MCP server to assess all eight devices in arista_ceos. Use
> clab/testlab.clab.yaml as the expected topology and verify observed neighbors
> with LLDP, interface state, IPv4 BGP, and EVPN BGP evidence. Generate
> .local-artifacts/reports/fabric-health.html using the shared report requirements.
> Put the two spines above the six leaves in an interactive topology diagram.
> Selecting a device or link should reveal the supporting observations. Separate
> management readiness, underlay adjacency, overlay adjacency, and redundancy.
> Identify missing expected links and failed sessions, and rank findings by
> observed impact. Do not change configuration.

**Visual design:**

- A full-width topology map with labeled link state and device status badges.
- Summary cards for responding devices, expected links confirmed up, and
  Established versus expected BGP neighbor entries by address family.
- A leaf table showing its two expected uplinks and observed redundancy.
- An evidence drawer or expandable panel containing command output and errors.

**Evidence and interpretation:** Expected physical links come from the topology;
missing LLDP information alone does not establish that a link is down. Report
each BGP adjacency once in a topology view, or explicitly label counters as
per-device neighbor entries to avoid counting both ends as distinct sessions.
An inaccessible device should remain unknown rather than appear healthy through
its neighbors' observations.

**Useful tools:** `eos_list_inventory`, `eos_probe_devices`, `eos_run_show`.

**Why it works:** The audience can see the failure's location and the surviving
redundancy before opening supporting details.

## 8. Underlay and tenant reachability heatmaps

**Skill:** [eos-reachability-report](../skills/eos-reachability-report/SKILL.md).

**Setup:** No fault injection is required. Optionally stage scenario 2 to make
one tenant's failures stand out against the working underlay and other tenant.

**Demo prompt:**

> Discover the six leaves' VTEP source addresses and unique diagnostic loopback
> addresses in VRF10 and VRF11. Run one complete directed reachability matrix in
> each of three contexts: underlay VTEP IPs in the default VRF, VRF10 diagnostic
> loopbacks, and VRF11 diagnostic loopbacks. Exclude self-tests. Pin each test to
> the executing leaf's address in the selected context and use three packets per
> destination. Respect the server's current diagnostic limits. Generate
> .local-artifacts/reports/reachability-matrices.html using the shared report
> requirements. Include three labeled 6-by-6 heatmaps, a packet-loss/average-RTT
> view selector, and selectable cells showing exact test parameters and results.
> Summarize patterns of failures without assigning an unproven cause. Do not
> change configuration.

**Visual design:**

- Three comparable heatmaps with source rows, destination columns, and disabled
  diagonal cells.
- Clearly different representations for packet loss, execution errors, and
  tests that were not run.
- Separate scales for loss and RTT; use a common RTT scale across all three
  matrices and display missing RTT as unavailable rather than zero.
- A ranked list of the highest measured average RTTs, plus a searchable results
  table and per-cell evidence panel.

**Evidence and interpretation:** Six leaves produce 30 directed paths per
context: 90 path observations and 270 requested echo packets for this run.
Three packets per path constitute one matrix round. If requesting three rounds,
repeat all matrices and record each round separately. Report execution coverage
alongside reachability so skipped or failed tool calls cannot disappear from
the denominator. A missing source interface or address makes that test
unavailable; do not silently substitute another source.

Underlay results establish VTEP IP reachability. Tenant results test the unique
remote loopbacks in their VRFs. Only a matching encapsulation capture establishes
observed VXLAN packet evidence. cEOS RTT samples describe this container lab;
three packets do not establish a performance baseline or SLA.

**Useful tools:** `eos_run_show`, `eos_ping`; optionally `eos_packet_capture` for
a selected tenant test.

**Why it works:** A row, column, or tenant-specific failure pattern becomes
immediately visible, while selecting a cell exposes the exact failed test.

## 9. Incident report: baseline, degraded, recovered

**Skill:** [eos-incident-report](../skills/eos-incident-report/SKILL.md).

**Setup:** Use scenario 1. Collect three snapshots around a manually staged
uplink shutdown and restoration.

**Demo prompt:**

> Create a three-phase incident report for node2-1 losing its Ethernet1 uplink.
> Collect and save a healthy baseline first. I will stage the fault and tell you
> when to collect the degraded snapshot, then restore the link and tell you when
> to collect the recovery snapshot. At each phase, collect both ends' interface
> and BGP state, node2-1's route to 10.255.1.4, and a three-packet ping to that
> destination sourced from 10.255.1.3. Collect relevant bounded logs where
> available. After all three phases, generate
> .local-artifacts/reports/uplink-incident.html using the shared report
> requirements. Highlight what changed, whether connectivity survived, and
> whether redundancy returned. Do not stage or restore the fault yourself.

**Visual design:**

- A three-column comparison: baseline, degraded, recovered.
- An SVG topology for each phase, highlighting the affected and surviving paths.
- A route next-hop comparison and measured loss/RTT bars by phase.
- A timeline separating operator-reported actions, snapshot collection times,
  and device log events.
- A concise incident narrative with expandable evidence for every conclusion.

**Evidence and interpretation:** Save phase data immediately so later queries
cannot overwrite the baseline. Missing phases remain explicitly incomplete.
Three snapshots do not measure convergence time, continuous availability, or
outage duration. Device event times and collection times are different; identify
timezone and clock uncertainty when comparing logs across devices.

**Useful tools:** `eos_run_show`, `eos_ping`, `eos_show_logging`.

**Why it works:** It turns a live fault demonstration into a clear incident
artifact showing impact and recovery.

## 10. Tenant route-import investigation report

**Skill:** [eos-tenant-report](../skills/eos-tenant-report/SKILL.md).

**Setup:** Start healthy, or remove node2-1's VRF10 import route target as in
scenario 2. Use VRF11 as the comparison tenant.

**Demo prompt:**

> Investigate VRF10 and VRF11 connectivity from node2-1 to the unique diagnostic
> loopbacks on node2-2 through node2-6. Discover addresses rather than assuming
> them. Check EVPN sessions, remote diagnostic prefix advertisements, local VRF
> route installation, import/export route targets, L3 VNI mappings, underlay
> routes to remote VTEPs, and return routes for the chosen sources. Run bounded
> source-pinned tenant pings. Generate
> .local-artifacts/reports/tenant-route-investigation.html using the shared
> report requirements. Show where the evidence chain first becomes missing or
> inconsistent. Separate confirmed configuration mismatches from hypotheses;
> propose a focused next check for unresolved findings. Do not change
> configuration.

**Visual design:**

- Side-by-side VRF10 and VRF11 panels with route targets and L3 VNI labels.
- A tenant-by-remote-leaf status grid for route presence and ping results.
- An evidence-chain diagram: remote prefix advertised → local EVPN visibility →
  VRF import → next-hop resolution → reachability test, with return routing shown
  alongside it. Each stage links to its evidence and can be unknown.
- Highlighted, redacted configuration excerpts showing relevant differences.

**Evidence and interpretation:** BGP session establishment does not establish
that a particular route was advertised or imported. Attribute each stage to the
device and routing context queried. An EVPN-visible prefix missing from the VRF
table supports investigation of import policy; confirm the relevant route
targets before declaring the cause. Distinguish L3 VNI 10/11 from the VLAN-backed
L2 VNIs such as 10011/10021.

**Useful tools:** `eos_run_show`, `eos_get_running_config` with a relevant section,
`eos_ping`.

**Why it works:** It explains a tenant-specific failure through an inspectable
chain of evidence rather than a wall of routing output.

## Suggested presentation sequence

For a 15-minute presentation, use **1 → 2 → 5**:

1. Hidden loss of redundancy.
2. A tenant-specific routing failure with a healthy underlay.
3. Packet evidence tied to BGP state.

Rehearse fault staging, recovery, and capture timing before the presentation.
Keep the healthy baseline available for comparison.

For a report-focused presentation, start with **7** for the fabric overview,
use **8** to expose the pattern of affected paths, and finish with **9** for
the before/after incident artifact. Use **10** when demonstrating EVPN and VRF
diagnosis in more depth.

## Extension: L2 VXLAN endpoint troubleshooting

Add two Linux hosts attached to different leaves to demonstrate MAC learning and
bridging across an L2 VNI. Use unique host IPs and MACs, then correlate local MAC
learning, EVPN advertisements, remote VXLAN MAC entries, and traffic captures.

The live VXLAN MAC tables were empty during the starting-point check. Those
tables map remote MACs to VLANs and VTEPs; see
[Arista's VXLAN documentation](https://www.arista.com/en/um-eos/eos-vxlan-configuration).
The existing tenant loopbacks already support the routed-overlay demonstration.

A VTEP Loopback1 ping tests routed underlay reachability. To demonstrate VXLAN
encapsulation, correlate a tenant-context test to a unique remote destination
with an underlay capture filtered for `udp port 4789`. A shared anycast gateway
address can terminate locally and is unsuitable as proof of remote forwarding.

Packet capture visibility depends on platform: the MCP capture tool does not
provide visibility into hardware-forwarded transit traffic on physical switches.
These demonstrations target the cEOS containerlab environment, without claims
about physical CRC errors, optics, or ASIC behavior.
