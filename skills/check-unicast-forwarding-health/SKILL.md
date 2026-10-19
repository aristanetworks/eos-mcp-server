---
name: check-unicast-forwarding-health
description: Trace a specific IPv4 unicast flow through Arista EOS L2 or L3 forwarding state using the eos MCP server. Correlate active routes, ARP, MAC tables, VLANs, VTEPs and candidate egress interfaces while distinguishing software state, ASIC programming and receiver delivery. Read-only.
trigger: |
  TRIGGER when the user asks to trace or qualify a specific IPv4 unicast flow, investigate unicast reachability, correlate route/ARP/FDB/VTEP resolution, or check both directions of a unicast path.

  SKIP configuration changes, active traffic tests, multicast, IPv6, non-Arista platforms, and isolated interface/VLAN/route/EVPN audits without a flow to trace (use the corresponding health skill).
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_get_facts
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
---

# Check IPv4 unicast forwarding health

Trace one direction of a defined flow and identify the first demonstrated break
or unresolved dependency. This skill reads existing state. It does not generate
traffic, run ping/traceroute, capture packets, clear tables/counters, change
configuration, or move hosts. An offline-only request means analyze supplied
artifacts without contacting devices. Ordinary ARP/FDB inspection does not
require a host-mobility or duplicate-address test.

## Define the flow and evidence window

Record the source/destination IPv4 addresses, L2 or L3 scope, ingress inventory
host/interface, local VLAN or bridge domain, and routing VRF where applicable.
Record source/destination MACs and wire VLAN tags when available. Include the
IP protocol, ports and packet size if supplied; these can affect hashing, policy
and MTU conclusions. Do not infer a tenant VRF from the management address.

Use inventory host/group names as MCP targets; packet IPs are lookup operands,
not targets. If the target is ambiguous, inspect inventory and clarify the
missing mapping. If the flow or L2/L3 scope is incomplete, state what can be
checked and what remains unknown instead of inventing endpoints or topology.

Record collection times and the EOS version/model from supplied facts or
`eos_get_facts` when device reads are authorized. Compare observations from the
same interval; conflicting or stale snapshots leave that dependency
indeterminate. Identify expected endpoint attachments from supplied topology
or evidence, not interface descriptions alone.

For bidirectional qualification, create separate A-to-B and B-to-A records.
Reverse the packet fields, identify the actual reverse ingress/VRF, and perform
each lookup independently. The return path can use different routes, VLANs,
gateways, VTEPs and physical members.

## Collect narrowly and preserve failures

Read the [command registry](references/commands.md) before selecting commands.
Use its default/named-VRF forms and output handling. Batch independent commands
on a common inventory target; wait for route/ARP/MAC results before constructing
dependent lookups. Use a subgroup or host when lookup operands differ between
devices. Restrict running-config reads to the relevant interface or routing
section through `eos_get_running_config`.

Retain command, device, timestamp, output format and relevant returned fields.
Report unsupported syntax, missing JSON fields, permission/transport failures
and size limits explicitly. None means an empty table or a healthy device.
If a batch fails without usable command results, retry smaller read batches to
isolate the unsupported command. Never silently remove an expected device,
VRF, VLAN or route from the result.

## L3: active route to resolved adjacency

Establish whether ordinary destination-based lookup applies. A known policy
route, service insertion or other forwarding override needs its own evidence;
the active IP route alone does not select the packet's path through that policy.

1. Look up the **destination host address** in the ingress VRF for longest-prefix
   matching using `show ip route`. EOS documents this as a **FIB view**; report
   it as software forwarding state, not ASIC programming or RIB best-path proof.
   Record the prefix, route source, action, next hops and egress interfaces.
   Use the separate `show rib route ip` lookup when RIB selection/recursion must
   be inspected: interpret the returned legend for best route, unresolved next
   hop and recursive loop. A protocol advertisement alone does not establish
   an entry in the forwarding view. Include a matching default route;
   do not require a host route. A discard route is a demonstrated route action;
   a local/receive route terminates on the device rather than forwarding onward.
2. Resolve recursive next hops in the indicated VRF until an attached adjacency
   or tunnel is reached. Retain every installed ECMP candidate. Track visited
   VRF/address pairs and stop on a cycle, missing route or unresolved dependency.
   Compare RIB resolution with the FIB view if they disagree or the forwarding
   entry is absent. Follow an explicit egress-VRF transition when present;
   do not assume every recursive lookup stays in the tenant VRF.
3. For ordinary Ethernet forwarding, inspect ARP for the **resolved next-hop
   address** in its egress VRF. Use the destination IP itself only for a directly
   connected destination. Record IP, MAC and logical interface; cross-check the
   interface and VLAN. An absent/incomplete entry is an unresolved adjacency at
   collection time, not proof of a persistent fault or hardware drop.
4. For an SVI, resolve the adjacency MAC in the egress VLAN's MAC table and
   continue with the L2 procedure. For a routed physical interface or routed
   Port-Channel, inspect that interface/aggregate; a bridge FDB lookup is not a
   prerequisite. Do not demand local ARP for a remote tenant host when the route
   resolves directly to a VXLAN VTEP/VNI/router-MAC tuple; use the overlay branch.

## L2: destination MAC to eligible egress

1. Establish the frame's destination MAC on this segment. In L2 scope it may be
   supplied or corroborated by existing neighbor information; ARP on every L2
   switch is not required. An off-subnet host initially addresses its gateway
   MAC, not the remote host MAC. If the MAC cannot be established, leave the
   FDB lookup unresolved.
2. Look up that MAC **in the effective local VLAN/bridge domain**. Record entry
   type and local interface or remote VTEP association. VLAN IDs alone do not
   prove the same bridge domain across a trunk, translation, tunnel or overlay.
   Map wire tags, access/native VLAN, translations and VLAN-to-VNI bindings at
   each boundary using scoped evidence; do not assume equal wire/local IDs.
3. Check that the VLAN and intended ingress/egress ports are operationally
   eligible: switchport mode, allowed/active VLAN membership and STP state where
   applicable. STP blocking on an unrelated redundant port is not a flow fault.
   An active SVI alone does not prove local bridge forwarding, and a suspended
   VLAN on the required path is material evidence.
4. A missing FDB entry means known-unicast resolution is absent. Unknown-unicast
   flooding or suppression depends on the effective bridge policy and eligible
   ports; absence alone proves neither loss nor delivery. Preserve static,
   dynamic, shared/anycast and multihoming context rather than treating repeated
   MACs on different devices as a fault.

## Overlay branch: remote MAC or routed VXLAN destination

For a remote L2 destination, correlate the local VLAN/L2 VNI, remote MAC entry
and VTEP association. For routed VXLAN, record the route's VTEP, L3 VNI and
router MAC as actually returned. Distinguish symmetric and asymmetric IRB
requirements from the supplied design; a routed remote destination need not
have a local tenant-MAC FDB entry.

Use [check-evpn-health](../check-evpn-health/SKILL.md) for relevant type-2/type-5
import and mapping diagnostics. An EVPN route being present/best does not prove
that it became a forwarding entry. Correlate it with the active IP route or
operational MAC/VXLAN table. Resolve each candidate VTEP through the **underlay
VRF** to its local next hop and adjacency, then repeat at an identified egress
VTEP if evidence/access permits. Do not look up the VTEP in the tenant VRF by
default, and do not ARP for a remote VTEP across routed hops.

Missing egress-device evidence leaves the remote segment indeterminate.
For MLAG or EVPN multihoming, keep the shared VTEP/ESI and alternate egress
context; DF state for BUM traffic does not select a known-unicast physical path.

## Compose existing health checks at the dependency that needs them

| Dependency | Skill | Evidence to reuse |
| --- | --- | --- |
| Physical/logical ingress or egress | [check-interface-health](../check-interface-health/SKILL.md) | Link/line protocol, MTU, relevant errors/discards |
| Routed lookup or VRF discrepancy | [check-route-health](../check-route-health/SKILL.md) | Active prefix, next hop, routing context |
| Bridge/SVI/trunk discrepancy | [check-vlan-health](../check-vlan-health/SKILL.md) | Effective VLAN, membership, STP/SVI state |
| Port-Channel adjacency or FDB egress | [check-port-channel-health](../check-port-channel-health/SKILL.md) | Active/bundled members, LACP, switchport state |
| VXLAN/EVPN resolution | [check-evpn-health](../check-evpn-health/SKILL.md) | MAC/VTEP/VNI, route import, gateway context |

Apply only the relevant read checks. Preserve expected-flow failures and the
proof distinctions below even if a component audit has a broader summary or
would omit a missing feature. Two counter snapshots can establish deltas
without clearing counters; interface totals remain shared by unrelated flows.
An ACL, policy or MTU issue remains a hypothesis until relevant evidence
supports it. Stop generic tracing at an unverified service/policy boundary and
state the missing evidence rather than declaring end-to-end health.

## Separate the claims

| Claim | Evidence required | Insufficient evidence |
| --- | --- | --- |
| RIB best route observed | Best-route marker and resolution in `show rib route ip` in the correct VRF | Protocol advertisement alone; labeling a FIB view as RIB proof |
| Software resolution consistent | Applicable ARP, FDB, VLAN/VNI/VTEP and interface state agree | Route alone, configured intent alone |
| Software FIB entry observed | Destination match and action/next hops in the correct VRF's `show ip route` FIB view | RIB best route, route count, ARP alone; this still does not prove hardware programming |
| ASIC programming observed | Verified SKU/EOS-specific read output matching prefix/VRF and resolved adjacency, with its ASIC scope | Capacity totals, a virtual switch, a generic route/neighbor dump |
| Physical path observed | Supplied flow-specific packet/path evidence for the interval | ECMP next hops, LACP members, predicted hash result, interface totals |
| Receiver delivery observed | Supplied receiver evidence tied to this flow, direction and interval | Any control/software/ASIC entry, sender counters or aggregate interface Rx |

ECMP and LACP describe **candidate members**. Even a supported hash prediction
is a prediction, not a captured physical path. A single observed packet does
not prove loss-free delivery over an interval. A loss-free claim also needs the
expected receive count and observed count/loss for the same direction, flow and
interval; aggregate totals across multiple flows or receivers are insufficient.

No generic hardware command is prescribed here. If ASIC proof is required,
first verify a read-only command for the exact model/ASIC and EOS release and
its coverage. If unsupported or unverified, report that limitation and keep
ASIC programming **not proven**. A capacity check in a component skill cannot
upgrade this claim. Report packet delivery separately even when an ASIC entry
is observed. Do not expand the task into active tests to fill evidence gaps.

## Report one record per direction

Use a flow header with packet fields, L2/L3 scope, ingress, VLAN/VRF and evidence
window, followed by a compact trace:

| Direction | Device/context | Lookup/action | Resolved neighbor/MAC/VTEP | Candidate egress | Evidence/status |
| --- | --- | --- | --- | --- | --- |

Use **consistent**, **demonstrated break**, **indeterminate**, **unsupported**,
or **not applicable** for each dependency, with the command or supplied artifact
that supports it. Keep observation separate from probable cause. Finish with
separate conclusions for RIB selection, software FIB, software resolution, ASIC
programming, physical path and receiver delivery. Include the first
unresolved dependency and the smallest additional read evidence needed.
When only state was inspected, say that forwarding state is consistent while
receiver delivery remains unverified. A bidirectional result remains incomplete
until both independent direction records have sufficient evidence.
