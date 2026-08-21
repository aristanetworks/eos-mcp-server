---
author: Matthieu Tache
name: check-evpn-multicast-health
description: Audit EVPN multicast health on Arista EOS devices via the eos MCP server. Covers Layer 2 optimized multicast with IMET/SMET/IGMP proxy, Layer 3 EVPN multicast IRB/OISM with SBD and S-PMSI, ingress replication versus underlay PIM-SSM, overlay-to-underlay encap/decap mappings, IGMP snooping EVPN groups, and PIM External Gateway DR state. Read-only - does not modify any device.
trigger: |
  TRIGGER when the user asks about EVPN multicast in any form, including: "EVPN multicast health", "EPVN multicast", "L2 multicast EVPN", "Layer 2 multicast EVPN", "L3 multicast EVPN", "Layer 3 multicast EVPN", "EVPN IRB multicast", "OISM", "optimized multicast", "selective multicast", "IMET multicast flags", "SMET routes", "S-PMSI", "SPMSI", "PMSI tunnel", "IGMP proxy", "redistribute igmp", "evpn multicast", "PIM external gateway", "PEG", "PIM-Tunnel", "multicast ipv4 evpn", "show multicast ipv4 evpn", or any question mentioning multicast alongside evpn/vxlan/vtep/overlay.

  SKIP when the request is about generic EVPN reachability without multicast symptoms (use check-evpn-health), IGMP snooping without EVPN overlay context (use check-igmp-health), underlay PIM without EVPN multicast context (use check-pim-health), configuration changes (writes), protocol theory unrelated to a live device, or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check EVPN multicast health on EOS devices

You are auditing EVPN multicast state on Arista EOS devices via the `eos` MCP server. This skill covers both:

- Layer 2 optimized multicast: IGMP snooping/proxy, `redistribute igmp`, IMET Type-3 routes, SMET Type-6 routes, and VXLAN flood lists.
- Layer 3 EVPN multicast / IRB / OISM: `evpn multicast`, SBD instances, S-PMSI Type-10 routes, overlay-to-underlay mappings, PIM-SSM underlay trees, and PIM External Gateway (PEG) behavior.

This skill is **read-only** - never call write tools, never modify configuration.

## When to use this skill

- Multicast receivers in an EVPN/VXLAN fabric do not receive traffic.
- Multicast floods to every VTEP instead of only interested receivers.
- The user asks whether an EVPN multicast deployment is using ingress replication or underlay PIM-SSM.
- The user asks about IMET, SMET, S-PMSI, OISM, SBD, PEG, `PIM-Tunnel`, or `multicast ipv4 evpn` state.
- After a maintenance window, to verify multicast overlay control plane and data plane convergence.

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly, use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops - the MCP server fans out concurrently.

## Phase 1 - EVPN multicast overview

Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show bgp evpn summary
show bgp evpn route-type imet detail
show bgp evpn route-type smet
show bgp evpn route-type spmsi detail
show ip igmp snooping groups local
show ip igmp snooping groups evpn
show multicast ipv4 evpn encap
show multicast ipv4 evpn decap received
show multicast ipv4 evpn decap joined
show bgp evpn sanity detail
```

If a command is unsupported on the EOS version or the feature is not configured, record it as "not present" and continue. Do not treat unsupported output as a failure by itself.

### Parsing the overview

**`show bgp evpn summary`** - confirm the EVPN control plane is usable before interpreting multicast routes.

Flag:
- Any EVPN peer not Established.
- Established peers with zero prefixes.
- Saturated peers (`s` status) because multicast route signaling may lag or be dropped.

**`show bgp evpn route-type imet detail`** - Type-3 IMET routes advertise VTEP participation and multicast capability per VLAN or SBD.

Check:
- Route status contains valid/best (`* >`) routes from expected VTEPs.
- `Multicast Flags` includes `IGMP proxy` for L2 optimized multicast.
- `Multicast Flags` includes `OISM-supported` and `SBD` for L3 EVPN multicast / IRB.
- `Multicast Flags` includes `PEG` only on PIM External Gateways.
- `PMSI Tunnel` shows the intended replication model: `Ingress Replication` or `PIM-SSM Tree`.
- `Tunnel ID` is correct: VTEP IP only for ingress replication; VTEP IP plus underlay multicast group for PIM-SSM.
- Route-Targets match the expected VLAN or VRF import/export policy.

Missing `IGMP proxy` means the peer is treated as interested in all overlay multicast and traffic may flood to it. Missing `OISM-supported` or `SBD` in an IRB deployment usually means `evpn multicast` is absent or the SBD instance did not form.

**`show bgp evpn route-type smet`** - Type-6 SMET routes signal receiver interest for a multicast group.

Check:
- Expected groups are present.
- Originating IPs match the VTEPs with interested receivers.
- RD scope matches the deployment:
  - L2 optimized multicast with `redistribute igmp`: VLAN/MAC-VRF RD.
  - L3 EVPN multicast / OISM with `evpn multicast`: VRF/SBD RD.
- Routes are valid/best where applicable.

No SMET for a group means either no receiver joined, IGMP/PIM interest was not learned, or EVPN multicast signaling is broken. In optimized multicast, missing SMETs usually cause unwanted flooding or missing selective delivery.

**`show bgp evpn route-type spmsi detail`** - Type-10 S-PMSI A-D routes advertise overlay-to-underlay multicast tunnel mappings.

Check:
- Each sending VTEP originates expected `(*,*)` or per-group S-PMSI routes.
- `PMSI Tunnel` matches the intended model.
- `Tunnel ID` maps to the expected underlay `(source VTEP, multicast group)`.
- `MPLS Label` / VNI matches the VLAN or SBD VNI.
- RD is VLAN-scoped for L2 entries and VRF/SBD-scoped for OISM entries.

Missing S-PMSI routes in a PIM-SSM deployment generally means the VXLAN multicast group is missing for the VLAN/VRF or the route was not imported due to RT mismatch.

**`show ip igmp snooping groups local`** - local receiver interest learned from directly attached hosts.

Check:
- Receiver-facing interfaces appear under the expected VLAN and group.
- A group missing from `local` means the leaf has no local IGMP receiver for that group.

**`show ip igmp snooping groups evpn`** - remote receiver interest learned from SMET / EVPN join synchronization.

Check member type:
- `PIM-Tunnel` - traffic should be VXLAN-encapsulated over an underlay PIM-SSM tree.
- `<vtep-ip>(IR)` - traffic should be head-end replicated to that VTEP.

If SMET exists but the group is missing from `groups evpn`, the BGP route may not be installed into snooping state.

**`show multicast ipv4 evpn encap`** - local overlay-to-underlay mapping.

Check:
- VLAN is the overlay VLAN for L2 entries or an internal SBD VLAN for VRF entries.
- `Encap Group` is the expected underlay multicast group.
- `Encap Source` is the local VTEP IP.
- `Tunnel Type` is `PIM-SSM` or `Ingress Replication` as designed.

**`show multicast ipv4 evpn decap received`** - remote mappings received from other VTEPs via BGP.

Check:
- All expected remote VTEPs appear as `Encap Source` values.
- The underlay group and tunnel type match what those VTEPs advertise in S-PMSI/IMET.

**`show multicast ipv4 evpn decap joined`** - underlay trees the local VTEP actually joined because it has interested receivers.

Interpretation:
- `decap received` present but `decap joined` absent is normal when the local VTEP has no receiver for that overlay group.
- `decap joined` missing while local receivers exist points to IGMP snooping, SMET, or PIM join failure.

**`show bgp evpn sanity detail`** - automated EVPN checks.

Report any `FAIL` or `WARN` verbatim. For EVPN multicast, pay special attention to checks for:
- Multicast software forwarding: `software-forwarding sfe` under `router multicast`.
- Extended community send.
- MAC-VRF route-target import/export.
- Multi-agent routing protocol model.

## Phase 2 - Layer 2 optimized multicast drill-down

Run this phase when the user asks specifically about L2 multicast over EVPN, when multicast floods across all VTEPs, or when Phase 1 shows missing SMET/IGMP proxy state.

```
show ip igmp snooping
show ip igmp snooping groups
show igmp snooping querier
show ip igmp snooping mrouter detail
show ip igmp snooping counters
show vxlan flood vtep
show vxlan vni
show interfaces vxlan 1
```

### L2 checks

**IGMP snooping status**

For each multicast VLAN:
- `IGMP snooping` should be enabled.
- `IGMP snooping pruning active` should be true when selective forwarding is expected.
- `EVPN proxy active` should be true in EVPN multicast deployments.
- `Flooding traffic to VLAN` should not be true for optimized multicast steady state.

**Querier**

Every receiver VLAN needs a querier. If no querier exists, receivers may not refresh joins, snooping pruning may go inactive, and traffic may flood.

**SMET and snooping correlation**

For a given `(VLAN, group)`:
- Local receiver present in `show ip igmp snooping groups local`.
- Local VTEP originates SMET in `show bgp evpn route-type smet`.
- Remote VTEPs show the group in `show ip igmp snooping groups evpn`.
- Source VTEP sends only to interested remote VTEPs via `PIM-Tunnel` or `<vtep>(IR)`.

**VXLAN flood list**

`show vxlan flood vtep` is useful for BUM and non-selective behavior:
- In EVPN ingress replication mode, VNI flood lists should be dynamically populated from IMET routes.
- In underlay multicast mode, the flood list may be empty because delivery uses PIM-SSM trees.
- Unexpected VTEPs in the flood list indicate unexpected IMET import or stale control-plane state.

## Phase 3 - Layer 3 EVPN multicast / OISM drill-down

Run this phase when the user asks about L3 multicast, IRB multicast, OISM, SBD, or traffic crossing routed VXLAN tenant boundaries.

Use known VRF names when available. If the user did not provide a VRF, inspect `show bgp evpn route-type imet detail`, `show multicast ipv4 evpn encap`, and `show vxlan vni` first to identify likely VRF/SBD entries.

```
show bgp evpn instance
show bgp evpn route-type imet detail
show bgp evpn route-type smet detail
show bgp evpn route-type spmsi detail
show multicast ipv4 evpn encap
show multicast ipv4 evpn decap received
show multicast ipv4 evpn decap joined
show ip mroute vrf <vrf-name> detail
show ip pim vrf <vrf-name> rp
```

When the VRF is known and the command is supported, add:

```
show bgp evpn instance sbd <vrf-name>
show multicast ipv4 evpn encap mapping vrf <vrf-name> <overlay-group>
```

### L3/OISM checks

**SBD instance**

`show bgp evpn instance sbd <vrf-name>` should show the SBD for every VRF with `evpn multicast`. Missing output means the VRF is not participating in OISM.

**IMET flags**

For OISM-capable VTEPs, IMET should carry:
- `IGMP proxy`
- `OISM-supported`
- `SBD`
- `PEG` only on external gateways

**SMET scope**

SMET routes for OISM are VRF/SBD-scoped. If SMETs are VLAN-scoped in a design that expects OISM, verify whether `redistribute igmp` is configured instead of or in addition to `evpn multicast`.

**Overlay mroute**

`show ip mroute vrf <vrf-name> detail` should have:
- Correct incoming interface based on the source location.
- SBD VLAN in the outgoing interface list when traffic is forwarded into EVPN.
- External-facing interface in the outgoing interface list when traffic is forwarded out to PIM.
- No duplicate SBD VLAN OIL across multiple PEGs for the same `(S,G)`.

Flags to notice:
- `S` - shortest path tree.
- `R` - rendezvous point tree.
- `P` - programmed.
- `V` - source reachable via EVPN tenant domain.

**RP and IGMP in the tenant VRF**

Within the EVPN tenant domain, underlay delivery is PIM-SSM and does not need an RP. RP checks matter when the VRF connects to an external PIM-SM domain through a PEG.

## Phase 4 - Underlay PIM-SSM verification

Run this when Phase 1 shows `PMSI Tunnel: PIM-SSM Tree`, when `show multicast ipv4 evpn decap joined` has entries, or when encapsulated multicast is not arriving.

For each underlay `(source VTEP, encap group)` learned from `show multicast ipv4 evpn encap` or `decap received`, run:

```
show pim ipv4 sparse-mode route <source-vtep-ip> <underlay-multicast-group>
show ip route <source-vtep-ip>
show ip pim neighbor
show ip pim interface
```

### Underlay checks

**PIM route**

Check:
- Source VTEP has incoming interface `Loopback0` or the configured VTEP source interface.
- Receiver/transit VTEPs have incoming interface toward the source VTEP according to unicast RPF.
- RPF route resolves to the expected underlay path.
- Outgoing interface list is not empty on the source VTEP when remote receivers exist.
- Receiver VTEPs show the SBD/internal VLAN or relevant local interface when joined.

**PIM neighbors**

All underlay routed links in the multicast path need PIM sparse-mode neighbors. Missing neighbors or low expiry timers indicate underlay multicast instability.

## Phase 5 - PIM External Gateway checks

Run this when the user mentions PEG/PIM External Gateway, external multicast, external PIM routers, or when L3 multicast crosses between EVPN and a non-EVPN PIM domain.

```
show pim ipv4 sparse-mode evpn gateway detail
show pim evpn gateway dr
show ip mroute vrf <vrf-name> detail
show ip pim vrf <vrf-name> rp
```

### PEG checks

**Gateway presence**

`show pim ipv4 sparse-mode evpn gateway detail` should list every VRF for which the device is a PEG and show the internal SBD VLAN. If the VRF is absent, the device is not acting as a PEG for that VRF.

**DR election**

`show pim evpn gateway dr` should show:
- Role: `DR` or `non-DR`.
- DR address.
- Algorithm: `HRW`, `modulus`, or `preference`.

All PEGs in the same VRF should agree on the algorithm. Mismatches can fall back to modulus and elect an unexpected DR.

**Duplication and blackhole checks**

For a given `(S,G)`:
- The SBD VLAN should be in the OIL on exactly one PEG when forwarding from external PIM into EVPN.
- The elected PEG DR must have a healthy external PIM path and RP/receiver state when forwarding toward the external domain. Use `show ip pim neighbor` and targeted interface checks if the RP/mroute state points to an external PIM adjacency problem.
- A non-DR PEG forwarding to the SBD VLAN at the same time as the DR suggests duplicate delivery.

## Phase 6 - Hardware forwarding checks (only if needed)

Run platform-specific checks only when software/control-plane state looks correct but traffic still fails, or when the user asks for hardware programming validation.

```
show platform trident vxlan multicast tunnel detail
show platform trident exact-match multicast vxlan underlay
show hardware resource vxlanv4UnderlayMcastTable agent *
show platform fap vxlan vtep encapsulation multicast
```

Use the command that matches the platform family:
- Trident3 / 7050X3 / CCS-720XP: `show platform trident ...`
- Trident4 / 7050X4 variants: `show hardware resource vxlanv4UnderlayMcastTable agent *`
- Jericho / 7280R2: `show platform fap vxlan vtep encapsulation multicast`

Do not run all platform commands blindly across a large group. Unsupported platform commands are noisy and can distract from the operational finding.

## Quick decision tree

| Symptom | First checks | Likely cause |
|---|---|---|
| Multicast floods to every VTEP | IMET multicast flags, SMET routes, `show ip igmp snooping groups evpn` | Missing `IGMP proxy`, missing `redistribute igmp`, non-proxy-capable peer, or no SMET state |
| Local receiver not detected | `show ip igmp snooping groups local`, querier, counters | Receiver not sending reports, no querier, IGMP version mismatch, reports filtered |
| Remote receiver not detected | `show bgp evpn route-type smet`, `groups evpn` | SMET not originated/imported, RT mismatch, EVPN proxy inactive |
| PIM-SSM tunnel advertised but no traffic | `decap received`, `decap joined`, `show pim ipv4 sparse-mode route <S> <G>` | Local VTEP did not join tree, underlay PIM/RPF issue, no interested receiver |
| S-PMSI missing | `show bgp evpn route-type spmsi detail`, `show multicast ipv4 evpn encap` | Missing VXLAN multicast group, RT mismatch, feature not enabled |
| OISM/SBD absent | `show bgp evpn instance sbd <vrf>`, IMET flags | Missing `evpn multicast` under BGP VRF |
| Sanity reports multicast forwarding fail | `show bgp evpn sanity detail` | Missing `software-forwarding sfe` under `router multicast` |
| External multicast duplicates | PEG DR, `show ip mroute vrf <vrf> <S> <G> detail` on PEGs | More than one PEG has SBD VLAN in OIL |
| External multicast blackholes | PEG DR, external PIM neighbor/RP, mroute IIF/OIL | Elected PEG DR lacks external PIM path or RP state |

## Output format

Produce a structured Markdown report:

```
EVPN multicast health - <device or group>

Control plane:
- EVPN peers: N established, M with issues
- IMET: IGMP proxy on A/B VTEPs, OISM/SBD on C/D VTEPs
- SMET: K groups signaled, missing groups: <list or none>
- S-PMSI: P mappings, tunnel model: PIM-SSM / Ingress Replication / mixed

Receiver interest:
- Local IGMP groups: K
- EVPN-learned groups: M
- Delivery members: PIM-Tunnel / <vtep>(IR)

Overlay-to-underlay:
- Encap mappings: K
- Decap received: M remote mappings
- Decap joined: P active underlay joins

Warnings:
- <list concrete issues, or "none">

Next checks:
- <only include if issues remain, e.g. underlay PIM route for 10.0.0.10/225.1.1.1>
```

Summary
- State whether L2 optimized multicast is healthy, degraded, or not present.
- State whether L3 EVPN multicast/OISM is healthy, degraded, or not present.
- State the active replication model: ingress replication, underlay PIM-SSM, or mixed.
- End with a one-line conclusion even when everything is healthy.

## Don't

- Don't try config changes - this skill is read-only.
- Don't call `mcp__eos__eos_run_show` once per device; use a group target.
- Don't dump full BGP EVPN or mroute tables by default; use route-type filters and group/source-specific drill-downs.
- Don't confuse EVPN multicast overlay signaling with generic underlay PIM health; use PIM checks only after PMSI/decap state indicates underlay multicast is in use.
- Don't assume all EVPN multicast deployments use PIM-SSM; ingress replication and PIM-SSM can coexist per VLAN or VRF.
- Don't treat unsupported commands as failures when the feature is not configured or the EOS version predates the command.
