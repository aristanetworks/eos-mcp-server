# IPv4 unicast command registry

Read this before collecting flow evidence. Templates use square-bracket operands;
replace them with validated values before calling MCP. Do not send placeholders
literally. Angle brackets,
CLI pipes, shell metacharacters and multiline commands are rejected by
`eos_run_show`. Send output selection as `output_format`, never as `| json`.
Use only inventory names for `target`.

## Validation and applicability

Reviewed against the public EOS manuals listed below on 2026-10-19. This is
**documentary syntax validation**, with offline MCP input checks and a source
review of the output envelope, rechecked against the MCP source on 2026-11-10.
The hardware reference records its separate review date/version. This is not
evidence of execution on any EOS release, SKU or ASIC. The public IPv4 page
was labeled **EOS 4.36.2F** when read. The other linked chapters document generic
EOS forms; no minimum release or universal platform support is claimed.
Record the actual version/model and feature availability for each investigation.
Unsupported syntax or an unavailable feature must remain explicit in the report.

The registry deliberately uses text output as the baseline. JSON support and
payload layouts vary with command, EOS version and eAPI version. A text heading
is not a JSON key. `output_format: "auto"` tries JSON and falls back to text when
the server classifies JSON as unavailable; it does not turn arbitrary syntax,
permission or transport failures into successful reads. Inspect the actual
format and keep failed commands visible. Use `"text"` when no verified payload
schema is available. A too-large response requires a narrower supported query
or smaller target, not an assumption that the missing data was empty.

## IPv4 route, VRF and adjacency

Prefer explicit VRF qualification, including `vrf default` for the system default
VRF. An unqualified `show ip route` or `show ip arp` uses the context-active VRF,
which need not be `default`. When interpreting unqualified supplied output,
verify its context with C07 or the returned VRF; do not change the CLI context.

| ID | Command template | Relevant text observations | Limits/source |
| --- | --- | --- | --- |
| C01 | `show ip route vrf default [destination]` | Matched prefix, source legend, action, preference/metric, next hops and interfaces | Software FIB view; destination host lookup, not `longer-prefixes`; [IPv4] |
| C02 | `show ip route vrf [vrf] [destination]` | Same observations in the specified tenant, egress or underlay VRF | Follow the explicit resolution context; no ASIC guarantee; [IPv4] |
| C03 | `show ip arp vrf default [adjacency]` | Address, Age (min), Hardware Addr, Interface | Inspect the resolved on-link next hop or directly connected destination; [IPv4] |
| C04 | `show ip arp vrf [vrf] [adjacency]` | Same observations in the egress VRF | A remote tenant host need not have a local ARP entry on a routed VXLAN path; [IPv4] |
| C05 | `show rib route ip vrf default [destination]` | Best-route, unresolved-next-hop and recursive-loop markers; resolution chain | Inspect the actual legend (`>`, `*`, `L` in the documented example); RIB evidence; [IPv4] |
| C06 | `show rib route ip vrf [vrf] [destination]` | Same RIB selection/resolution in the specified VRF | Conditional on RIB/recursion investigation; not ASIC proof; [IPv4] |
| C07 | `show routing-context vrf` | Current VRF routing-context | Resolves interpretation of unqualified commands; does not change context; [IPv4] |
| C08 | `show vrf` | VRF, RD, protocols, routing state and interfaces | Establish relevant interface/VRF association; [IPv4] |

For recursive-next-hop or VTEP resolution, use C01/C02 again with the address
being resolved in place of `[destination]`, then C03/C04 for the final attached
adjacency. C05/C06 can inspect a recursive dependency using the same substitution.
Keep all ECMP paths in the returned prefix block; a prefix printed once can have
several following next-hop lines. Read the returned route legend rather than
hardcoding protocol-letter semantics.

The public manual calls `show ip route` a FIB view and `show rib route ip` a RIB
view. Keep those claims separate. Neither one verifies ASIC programming. No
command-specific JSON paths for route, RIB or ARP have been validated here;
the baseline contract is the relevant text observations above.

## L2, interfaces and overlay

| ID | Command template | Relevant text observations | Limits/source |
| --- | --- | --- | --- |
| C10 | `show mac address-table address [mac] vlan [vlan]` | VLAN, MAC, entry type, port; moves/last move if returned | Software MAC state in the effective VLAN; [L2] |
| C11 | `show vlan [vlan]` | VLAN status and member ports | Membership alone does not establish STP eligibility; [L2] |
| C12 | `show interfaces [interface] switchport` | Switchport, administrative/operational mode, access/native VLAN, enabled trunk VLANs | Correlate with active VLAN/STP state; [Interfaces] |
| C13 | `show spanning-tree vlan [vlan]` | Per-port role and forwarding/blocking state | Use only on the applicable bridge domain; [L2] |
| C14 | `show port-channel dense` | Aggregate, active member interfaces and legend/flags | Candidate member set, not a per-flow member observation; [Interfaces] |
| C15 | `show lacp peer` | Member port, peer system/port identity and LACP state when returned | LACP state alone does not prove distributing/collecting or packet delivery; [Interfaces] |
| C16 | `show interfaces [interface]` | Link/line protocol, MTU, packets/errors/discards when returned | Shared counters; compare timestamps/deltas rather than attributing totals to the flow; [Interfaces] |
| C20 | `show vxlan address-table address [mac] vlan [vlan]` | VLAN, MAC, entry type, interface and VTEP association(s) | Remote software MAC mapping, not hardware installation; [VXLAN] |
| C21 | `show vxlan vni [vni]` | VLAN or VRF mapping and VNI state/type when returned | Mapping interpretation depends on L2/L3 VNI and supplied IRB model; [VXLAN] |
| C22 | `show bgp evpn route-type mac-ip [mac]` | Type-2 route, route status, next-hop VTEP; VNI/RT/router-MAC if returned | Control-plane evidence; inspect matching VLAN/VNI/import context; [EVPN] |
| C23 | `show bgp evpn route-type ip-prefix [prefix] detail` | Type-5 prefix, status, next-hop VTEP, route targets and router-MAC/VNI if returned | Control-plane evidence; correlate with active tenant route; [EVPN] |

MAC and VXLAN address-table filters use the **local VLAN**; establish its wire-tag
mapping first. `show vxlan address-table` has no verified VNI filter here; use
the separate VNI lookup. A filtered result can still include multiple paths or
contexts; preserve them and match the flow's VLAN/VNI/VRF explicitly. Do not dump
the entire EVPN RIB to replace a filter that failed.

The EOS payload schemas for these commands have not been validated on a target
release in this skill. Prefer the text observations above until actual JSON keys
and optional fields are verified. Do not equate missing keys with empty tables
or convert an undocumented shape into a guaranteed parser contract.

## MCP envelope and output handling

The MCP tool result contains a serialized operation envelope. For
`eos_run_show`, inspect `results[]` by `inventory_hostname` and `status`.
Successful device entries contain `command_results[]`, with `command`,
`output_format` and `output` for each command. Failed device entries contain
`error_code` and `message`; they do not establish the state of any table.

When `output_format` is `"text"`, `output` is the normalized CLI text string.
When it is `"json"`, `output` is the command's EOS payload; preserve its actual
shape before interpreting fields. These envelope fields belong to this MCP
server, not to EOS CLI output. Keep `include_raw` off unless the raw eAPI
envelope is needed to diagnose output handling.

A command error can fail the device's batch without exposing partial results.
Split the batch to isolate the failure before drawing conclusions about the
other commands. Use the same flow context for dependent lookups; a group fanout
does not make identical VLAN/VRF operands valid on every device.

## Hardware evidence

Read [platform hardware evidence](hardware-evidence.md) for the in-scope family
profiles, exact public command examples, model/card restrictions, required
prerequisites and scope gaps. Select the hardware branch only after identifying
the forwarding ASICs. No family name makes a command universally supported.

Hardware identity and capacity are context. A platform-reported entry can be
software/agent state; verify hardware-source semantics before a programming
claim. It is not necessarily fresh ASIC readback; an empty exception view does
not prove an entry exists. Existing hardware-counter activity is not unique-flow or receiver proof.

## Public references

- [EOS Interface Configuration][Interfaces]
- [EOS Layer 2 Configuration][L2]
- [EOS Virtual Extensible LANs][VXLAN]
- [EOS Ethernet VPN][EVPN]
- [EOS IPv4][IPv4]

[Interfaces]: https://www.arista.com/en/um-eos/eos-interface-configuration
[L2]: https://www.arista.com/en/um-eos/eos-layer-2-configuration
[VXLAN]: https://www.arista.com/en/um-eos/eos-virtual-extensible-lans-vxlans
[EVPN]: https://www.arista.com/en/um-eos/eos-ethernet-vpn-evpn
[IPv4]: https://www.arista.com/en/um-eos/eos-ipv4
