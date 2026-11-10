---
name: check-multicast-forwarding-resources
description: Investigate EOS multicast forwarding resources, IPMC and replication capacity, counter allocation, and partial MRIB/MFIB egress mismatches. Separate node resource alarms from anomalies attributable to a specific flow. Read-only.
metadata:
  trigger: Multicast hardware resource full, IPMC capacity, replication exhaustion, UFT allocation, missing OIF despite programmed state, or unavailable multicast counters.
  skip: Configuration changes, capacity guarantees, protocol theory, or general IGMP/PIM/EVPN health without a forwarding-resource question.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_get_facts
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check multicast forwarding resources

Determine what resource condition the node reports and whether evidence links
it to the selected flow. A route reported as programmed can still have an
incomplete outgoing interface (OIF) set. Consistent MRIB/MFIB state alone does
not establish ASIC contents or receiver delivery.

Use [the command matrix](references/commands.md) for exact documented forms,
applicability, output meaning, and unavailable checks. The examples are IPv4;
do not substitute IPv6 addresses into them or assume equivalent selectors.

## Boundaries and ownership

- Use only the listed EOS read tools and runtime inventory targets. Never
  configure a profile/counter, clear state or counters, restart an agent, run
  a trace/capture, inject traffic, or use a shell fallback.
- Prefer eligible inventory groups for common reads. Select platform-specific
  subsets separately; do not send Trident commands to a mixed ASIC group.
- Start with scoped route reads and summaries. Per-route flexcounter dumps are
  conditional on a small, known table and a response-size budget. If no bounded
  supported form is available, retain the gap; do not invent a filter or pipe.
- [PIM health](../check-pim-health/SKILL.md) owns neighbors, RP, RPF, and routing
  intent; [IGMP health](../check-igmp-health/SKILL.md) owns receiver membership.
  [EVPN multicast health](../check-evpn-multicast-health/SKILL.md) owns
  IMET/SMET/S-PMSI, OISM/PEG, and overlay-to-underlay mapping.
  [Missing flow](../multicast-flow-missing/SKILL.md) owns the end-to-end symptom
  path. Reuse their evidence instead of repeating a broad audit.

## 1. Establish the comparison scope

Resolve the host/group with `eos_list_inventory` if needed. Use `eos_get_facts`
for EOS version and model; establish ASIC family from a source valid for that
exact SKU, or record it as unknown. Do not infer ASIC identity from a successful
command or inherit support/capacity from a similar model.

Record:

- Host, EOS release, SKU, ASIC/chip/unit scope, timestamp, and command format.
- Address family, VRF, VLAN/VNI, L2 snooping versus L3 routing, ASM/SSM/Bidir,
  and role: source/receiver leaf, transit, VTEP, DR/non-DR, or PEG.
- Exact `(S,G)` or `(*,G)` and expected IIF/OIFs, with the membership, joins,
  topology and role evidence that establishes each expected output.
- For VXLAN, separate tenant `(S,G,VRF,VNI)` from underlay
  `(source VTEP, encap group, underlay VRF)`. Record the encap/decap mapping and
  ingress replication versus underlay multicast model from the EVPN skill.
  One underlay tree can carry multiple tenant flows; do not equate the tuples.
- Observation interval and traffic expectation. Missing receiver/path
  expectations make completeness inconclusive, even if tables agree.

Use `output_format: "text"` for the documented views below. Public text does
not define an eAPI JSON contract. If JSON evidence is supplied, record its
command, format, API version, EOS release and field provenance before using
it; never require unverified keys or map missing fields to zero.

## 2. Separate intent, allocation, and effective profile

Read only justified bounded configuration sections with
`eos_get_running_config`, for example `platform`, `hardware`, or
`router multicast`. A section can establish configured intent for partitioning,
TCAM or counter enablement; it does not prove the active hardware profile.
Do not request the full running configuration by default.

On an applicable Trident platform, the documented forwarding-table partition
views report table sizes and, for `flexible`, bank allocation. Record actual
fields and shared/dedicated banks. They do not establish an effective Trident4
multicast profile or an IPMC/replication limit by themselves.

Keep three evidence columns: **configured intent**, **reported allocation**,
and **effective profile confirmed by an applicable operational view**. If the
last view is unavailable, say so. Do not invent a profile command, assume a
configured change is active, or propose a reload as part of this read workflow.
For a 7050X3/Trident3 versus 7050X4/Trident4 comparison, obtain evidence for each
SKU/release independently; capacities, fields and JSON schemas are not inherited.

## 3. Inspect distinct resource classes

Use the applicable rows of the command matrix. Preserve the original resource
name, units, used/limit/free/committed values, shared-pool scope, chip/unit and
sample time. Avoid a single combined multicast utilization percentage.

| Class | Required distinction |
| --- | --- |
| IPMC routes | Keep IPv4/IPv6 and `(*,G)`/`(S,G)` separate. MRIB route counts are not hardware occupancy. |
| Replication | Track multicast replication groups, head entries and list entries separately. A route can need multiple replication entries; groups can include both L2MC and L3MC. |
| VXLAN | Record only tables/rows actually exposed with applicable semantics. Generic capacity or partition output does not guarantee a dedicated VXLAN multicast table view. |
| Hardware counters | Feature allocation, per-route assignment and packet/byte values are different observations. Counter exhaustion does not establish replication exhaustion. |

`show hardware resource l3 summary` documents IPMC and replication rows, but
fields and applicability vary by platform. `show hardware capacity` reports
resource utilization where exposed; its example does not guarantee IPMC or
VXLAN multicast rows. A best-case maximum is not guaranteed usable capacity.
Do not sum rows sharing a pool or treat each feature's headroom as independent.

Compute utilization only with a known positive denominator and compatible units
and scope. Report a missing limit as unknown. Report zero allocation only when
the view's semantics establish that meaning; a zero denominator alone proves
neither exhaustion nor inapplicability. Distinguish an unsupported command,
transport/size failure, absent row, empty result and documented inapplicability.
Keep each failed or unavailable check visible in the report.

If operator evidence contains `hwResourceFull`, first establish whether it is
node-, table-, chip-, or route-scoped. This skill does not define that JSON key.
A global full warning is a node alarm even when selected routes report
`programmed=true`; it does not identify which flow or replica failed.
`hwResourceFull=false` does not establish complete OIFs or healthy resources
outside the field's documented scope.

## 4. Compare complete expected, MRIB, and MFIB sets

For an IPv4 flow in the default VRF, substitute every square-bracket placeholder
from runtime scope before calling `eos_run_show`. No placeholder is executable.
Select the source row locally from the group-scoped MRIB response:

```json
{
  "target": "[inventory-host-or-eligible-group]",
  "commands": [
    "show ip mroute [group]",
    "show multicast fib ipv4 [group] [source]",
    "show multicast fib ipv4 summary"
  ],
  "output_format": "text"
}
```

For a non-default VRF, use only an independently documented selector for the
required view. The matrix includes a VRF-qualified MFIB counter form but does
not establish every MRIB/MFIB VRF variant. Never compare tenant MRIB with a
same-address default-VRF MFIB; mark the unavailable side explicitly.

1. Preserve raw IIF/OIF lists, flags and route type for the same tuple/context.
   Read the flag legend from the observed release; do not assign a universal
   meaning to a letter such as `P`.
2. Build a normalization map before comparing. Account for a Port-Channel
   versus its active members, SVI versus VLAN replication ports, subinterfaces,
   tunnels/SBD mappings, DR/non-DR preinstalled outputs and pruning. Use the
   owning skills or supplied evidence for those mappings; do not assume every
   physical member is an independently required replica. Keep unresolved
   mappings inconclusive rather than removing them from the expected set.
3. Show the full normalized sets and differences: expected minus MRIB,
   expected minus MFIB, MRIB minus MFIB, and unexpected outputs. Route presence,
   equal counts, and a single matching output are insufficient.
4. If a difference could be convergence or sampling skew, repeat the same
   bounded reads with timestamps after an appropriate convergence/poll interval.
   Preserve membership, role and route-state changes between samples. A stable
   unexplained missing OIF is a mismatch even if a route reports programmed.
5. A `programmed` status is reported state within its verified scope. Do not
   treat it as an independent ASIC readback of every replica. A stable MRIB/MFIB
   mismatch alone proves neither an ASIC defect nor packet loss at a receiver.
   Correlate resource/forwarding warnings and the affected tuple/interface/time
   before attributing a cause. Use bounded `eos_show_logging` reads when useful.

Fastdrop entries require route/RPF/context analysis; their presence in a summary
alone does not make the selected flow faulty. Consistent lists mean only that
the observed views agree under the established normalization.

## 5. Qualify activity and counters

Use a supported per-flow counter form from the matrix. On applicable Trident
platforms, flexcounter summary can establish feature allocation; per-route
summary establishes assignment, and the values view exposes the raw values.
These are counter resources, not IPMC or replication-table capacity.

- `Activity never`, an old activity timestamp, `N/A`, or an absent counter is
  unknown traffic evidence until route type, support, enablement, allocation
  and polling are established. Activity uses polled hardware bits; record the
  actual poll interval and sample age. Do not assume the documented default.
- Counters can be disabled, unavailable due to shared resources, or unsupported
  for a route type. The documented IPv4 route-counter feature excludes fastdrop
  routes and supports only `(S,G)` for PIM sparse mode. Do not enable counters
  or clear them to improve observability.
- Compare two samples only with continuous route identity, counter assignment,
  units, scope and state. A reset, reassignment, fastdrop transition or decreasing
  value invalidates a simple delta. A cumulative nonzero value is historical;
  a valid zero delta describes only the measured interval and counter scope.
- Route ingress counters and activity do not prove delivery on every OIF.
  Keep existing per-receiver evidence separate. If receiver measurement is
  absent, report delivery unproven; do not start traffic or capture from here.

## Report and decision checks

Provide context, command/timestamp provenance, applicable and unavailable checks,
resource rows with units/scope, the three profile columns, expected/MRIB/MFIB
sets and differences, counter validity, and the next bounded read. Conclude
separately:

1. **Node resource state:** reported full/pressure, observed headroom in named
   resources, unknown, or inapplicable, with the evidence and coverage limits.
2. **Flow-attributable anomaly:** stable OIF mismatch, correlated programming
   failure, no mismatch observed, or inconclusive. State whether resource
   causality is established, suspected, or unresolved.
3. **Delivery evidence:** measured per receiver for a stated interval, or
   unproven. Do not label end-to-end forwarding healthy from software state.

Apply these safeguards even when only one field looks alarming or reassuring:

| Observation | Defensible conclusion |
| --- | --- |
| Global full warning; selected routes report programmed | Node alarm; flow attribution unresolved without correlated evidence. |
| Expected/MRIB has two outputs, MFIB has one despite programmed status | Unresolved or stable normalized OIF mismatch; never a green flow verdict. |
| Full flag false | No full condition reported in that field's scope; other resources and OIFs still need checks. |
| Activity never; counter absent or N/A | Traffic evidence unknown pending support/allocation/polling checks. |
| Capacity missing, zero, unsupported, or inapplicable | Preserve the distinct reason; do not substitute a numeric pass/fail. |
| X3 has a capacity row; X4 lacks it | X4 capacity unknown; no inherited limit or JSON compatibility. |
| Software views agree; no receiver measurement | No mismatch observed in those views; delivery unproven. |
