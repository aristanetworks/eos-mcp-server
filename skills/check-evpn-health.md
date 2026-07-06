---
author: Matthieu Tâche
name: check-evpn-health
description: Audit EVPN health on Arista EOS devices via the eos MCP server. Covers BGP EVPN sessions, VXLAN data plane, VNI mappings, remote MAC/VTEP tables, EVPN multihoming (ethernet-segment, DF election), EVPN multicast (IMET, SMET, ingress replication vs underlay PIM-SSM), EVPN gateway (type-5 IP prefix, symmetric/asymmetric IRB, inter-VRF routing), ARP suppression, MAC mobility, and host-flap detection. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about EVPN in any form, including: "EVPN status", "EVPN health", "EVPN routes", "EVPN summary", "EVPN neighbors", "EVPN instance", "VXLAN VTEPs", "VXLAN VNI", "VXLAN address-table", "remote MAC", "MAC mobility", "host-flap", "duplicate MAC", "type-2 routes", "type-3 routes", "type-5 routes", "IMET", "SMET", "ip-prefix routes", "EVPN multicast", "EVPN gateway", "symmetric IRB", "asymmetric IRB", "ethernet-segment", "designated forwarder", "DF election", "multihoming", "ESI", "EVPN sanity", "ARP suppression", "show vxlan", "show bgp evpn", or any question mentioning evpn/vxlan alongside a hostname, group, or "all" devices.

  SKIP when the request is about EVPN configuration changes (writes), EVPN protocol theory unrelated to a live device, pure BGP underlay questions (use check-bgp-health instead), IGMP snooping questions (use check-igmp-health), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check EVPN health on EOS devices

You are auditing EVPN state on Arista EOS devices via the `eos` MCP server. This skill covers the full EVPN stack: BGP EVPN control plane, VXLAN data plane, EVPN multihoming, EVPN multicast, and EVPN gateway (L3 VPN / IRB). This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about EVPN health, VXLAN state, remote MACs, VTEPs, or VNI mappings
- Overlay connectivity issues — hosts on different VTEPs can't reach each other
- MAC mobility or duplicate MAC problems
- EVPN multihoming DF election verification
- EVPN multicast (IMET, SMET) or gateway (type-5, IRB) health
- After a maintenance window, to verify the fabric converged

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly, use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently.

## Phase 1 — Core EVPN overview

Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show bgp evpn summary
show vxlan vtep
show vxlan vni
show interfaces vxlan 1
```

### Parsing the overview

**`show bgp evpn summary`** — for each peer, extract:
- Neighbor IP address
- AS number
- State/PfxRcd (if a number → Established with N prefixes; if a state string → not established)
- Up/Down timer
- Status codes: `m` = under maintenance, `s` = saturated, `x` = disabled

Flag:
- Any peer not Established
- PfxRcd = 0 on Established peers (peer not advertising routes)
- `s` (saturated) — output queue congested

**`show vxlan vtep`** — list of remote VTEPs discovered. Check:
- All expected VTEPs present
- No unexpected VTEPs (cross-reference with `show bgp evpn route-type imet`)
- VTEP count not fluctuating (indicates flapping)

**`show vxlan vni`** — VNI-to-VLAN and VRF-to-VNI mappings. Check:
- All expected VNIs present with correct VLAN
- No VNI without a VLAN (VLAN not created)
- VRF VNIs present for symmetric IRB

**`show interfaces vxlan 1`** — VXLAN tunnel interface status. Check:
- Interface is up
- Source interface (loopback) is correct
- Flood list source shows EVPN (not static)

## Phase 2 — Route and forwarding state (conditional)

Run when Phase 1 is healthy but overlay connectivity is broken, or for a deeper audit.

### EVPN routes by type

```
show bgp evpn route-type imet
show bgp evpn route-type mac-ip
```

**Type-3 IMET routes** — each VTEP advertises one per VNI to signal flood list membership. Missing IMET routes from a VTEP means BUM traffic won't reach it. Check PMSI Tunnel type: `Ingress Replication` or `PIM-SSM Tree`.

**Type-2 MAC/IP routes** — host MAC and optional IP bindings. Route status codes:
- `*` = valid, `>` = best path, `E`/`e` = ECMP, `#` = not installed, `S` = stale

Flag:
- `#` (not installed) — RT mismatch or missing local VLAN/VNI
- `S` (stale) — graceful restart leftover, peer hasn't refreshed
- Rapidly incrementing MAC mobility sequence numbers — MAC flapping

### Remote MAC and ARP tables

```
show vxlan address-table
show bgp evpn host-flap
```

**`show vxlan address-table`** — remote MACs with VTEP associations. Check:
- High `Moves` count on any MAC — flapping between VTEPs (loop, duplicate MAC, VM migration oscillation)
- Table size — empty or much smaller than expected means type-2 routes not being imported

**`show bgp evpn host-flap`** — MACs currently blacklisted due to excessive flapping. Default: 5 moves in 180s triggers blacklist for 300s.

### VRF routing (symmetric IRB / gateway)

```
show ip route vrf <vrf-name>
```

For symmetric IRB, remote host routes show as `via VTEP <ip> VNI <l3-vni> router-mac <mac>`. Check:
- Expected prefixes are installed
- Next-hop points to the correct remote VTEP
- L3 VNI and Router MAC are present

## Phase 3 — EVPN Multihoming (conditional)

Run when the user asks about multihoming, DF election, or ESI state, or when traffic loss is observed on multi-homed ports.

```
show bgp evpn instance
show bgp evpn route-type ethernet-segment
show bgp evpn route-type auto-discovery
```

**`show bgp evpn instance`** — per-EVI state including Ethernet Segment details:
- ESI, interface, mode (all-active / single-active)
- ES state (up/down)
- DF election algorithm (modulus, preference, hrw)
- Designated forwarder and non-designated forwarder VTEP IPs

**`show bgp evpn route-type ethernet-segment`** — type-4 routes with DF election extended communities. Compare `DF Election: Preference` values across peers. All PEs on the same ES must have matching ES-Import RT.

**`show bgp evpn route-type auto-discovery`** — type-1 A-D routes. A withdrawn per-ES A-D route means the remote ES interface is down, triggering mass MAC withdrawal.

### DF election algorithms

| Algorithm | Behavior |
|-----------|----------|
| **Modulus** (RFC 7432 default) | `V mod N` — adding/removing a PE reshuffles many VLANs |
| **Preference** (RFC 8584) | Highest (or lowest) preference wins. Supports `dont-preempt` for non-revertive failover |
| **HRW** (RFC 8584) | Hash-based distribution — only affected VLANs reshuffle on PE loss |

### Single-active VLAN blocking

In single-active mode, `show vlan configured` shows `#` on ports where traffic is blocked (non-DF for that VLAN on that ES).

## Phase 4 — EVPN Multicast (conditional)

Run when the user asks about EVPN multicast or when BUM/multicast traffic is not being delivered across the overlay.

```
show bgp evpn route-type imet detail
show bgp evpn route-type smet
show vxlan flood vtep
```

**`show bgp evpn route-type imet detail`** — check:
- **Multicast Flags: IGMP proxy** — indicates the VTEP supports selective multicast forwarding. Missing when `redistribute igmp` (L2) or `evpn multicast` (IRB) is not configured.
- **PMSI Tunnel** — `PIM-SSM Tree` (underlay multicast) or `Ingress Replication` (head-end replication). Must match the deployment model.

**`show bgp evpn route-type smet`** — type-6 Selective Multicast Ethernet Tag routes. Signal interest in specific overlay multicast groups so the source PE only replicates to interested PEs.

**`show vxlan flood vtep`** — head-end replication flood list per VNI. When using underlay multicast, the flood list may be empty (delivery via PIM-SSM trees).

### EVPN multicast with underlay PIM-SSM

```
show multicast ipv4 evpn encap
show multicast ipv4 evpn decap received
show bgp evpn route-type spmsi detail
```

**Type-10 S-PMSI-AD routes** carry the overlay-to-underlay group mapping in the PMSI tunnel attribute. The `detail` view shows the binding between overlay VNI and underlay (S,G) tree.

### EVPN multicast edge cases

- `EVPN proxy active: False` in `show ip igmp snooping` — missing `redistribute igmp` or `evpn multicast`
- Non-IGMP-proxy-capable peer (no flag in IMET) — treated as interested in all multicast traffic ((\*,\*)), floods everything to it
- IGMP snooping querier conflict — don't configure L2 snooping querier on VLANs where `evpn multicast` is active
- Missing `software-forwarding sfe` under `router multicast` — causes silent multicast traffic loss when `evpn multicast` is configured

## Phase 5 — EVPN Gateway / L3 VPN (conditional)

Run when the user asks about EVPN gateway, type-5 routes, inter-VRF routing, or symmetric IRB.

```
show bgp evpn route-type ip-prefix detail
show ip route vrf <vrf>
show ip virtual-router
```

**`show bgp evpn route-type ip-prefix detail`** — type-5 IP prefix routes. Check:
- Extended communities: Route-Target, TunnelEncap (VXLAN), EvpnRouterMac
- VNI label (must be the L3 VNI for the IP-VRF)
- Next-hop (VTEP IP)
- Router MAC (used as inner DMAC for VXLAN routed frames)

**`show ip route vrf <vrf>`** — routes imported from EVPN show as `via VTEP <ip> VNI <l3-vni> router-mac <mac>`. Two VTEPs with different router-macs indicates L3 ECMP across multi-homed PEs.

**`show ip virtual-router`** — verify VARP MAC and virtual IP addresses on SVIs. VARP MAC must be consistently configured across all IRB VTEPs.

### Asymmetric vs symmetric IRB

| Aspect | Asymmetric | Symmetric |
|--------|-----------|-----------|
| VNI in VXLAN header | Destination VLAN's L2 VNI | IP-VRF's L3 VNI |
| Inner DMAC | Destination host MAC | Egress VTEP Router MAC |
| VTEP VNI requirements | All VLANs on all VTEPs | Only local VLANs needed |
| Scale | Constrained by VNI/FIB on every leaf | Better — leaves carry only local subnets |
| Route types | Type-2 with L2 VNI only | Type-2 with L2+L3 VNI, Type-5 |

### Inter-VRF routing

Three methods:
1. **BGP VPN route leaking** — RT export from source VRF, RT import into destination VRF
2. **VRF-leak agent** — `router general` with `leak routes source-vrf` and route-map policy
3. **Static inter-VRF routes** — `ip route vrf <vrf> <prefix> egress-vrf <vrf> <next-hop>`

## Phase 6 — Automated sanity (EOS 4.29.1F+)

```
show bgp evpn sanity
```

Performs automated verification across L2 EVPN, L3 EVPN, EVPN VXLAN, and multihoming categories. Report any failures verbatim.

Also check MLAG VXLAN consistency when applicable:

```
show mlag
show vxlan mlag config-sanity
```

Verify: shared VTEP IP, shared Router MAC, identical VLAN-VNI mappings, identical flood lists, consistent ARP tables.

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| BGP EVPN peer not Established | Underlay reachability broken, `address-family evpn` not activated, or missing `send-community extended` |
| PfxRcd = 0 on Established peer | Peer has no VNI/VLAN configured, or RT export mismatch |
| Remote VTEP missing | No type-3 IMET route from that VTEP — check its VNI config and BGP session |
| VNI present but no VLAN | VLAN not created on the device — EVPN won't advertise type-3 routes |
| Remote MAC not in address-table | Type-2 route not imported — RT mismatch, or VLAN/VNI not configured locally |
| MAC flapping / high move count | Duplicate MAC, VM migration loop, or network loop. Check `show bgp evpn host-flap` |
| Type-5 prefix in BGP but not in VRF routing table | VRF import RT mismatch, or VRF-to-VNI mapping missing |
| Missing Router MAC in type-5 route | Receiving VTEP can't construct inner Ethernet header — traffic silently dropped |
| Asymmetric IRB silent drops | Missing tenant VLAN on a routing VTEP — all VLANs must exist on all VTEPs in asymmetric mode |
| DF election unexpected winner | Preference values misconfigured — compare across ES peers |
| ES state down | Physical interface or Port-Channel is down, or STP blocking |
| ES-Import RT mismatch | Type-4 routes not imported across ES peers — DF election incomplete |
| EVPN multicast not working | Missing `redistribute igmp` (L2) or `evpn multicast` (IRB), or `software-forwarding sfe` not configured |
| IMET without IGMP proxy flag | VTEP not configured for selective multicast — remote PEs flood all multicast to it |
| ARP timeout > MAC timeout | MAC type-2 route withdrawn while MAC+IP route persists — stale ARP binding |
| `service routing protocols model multi-agent` missing | Required for EVPN — switch must be rebooted after enabling |

## Output format

Produce a structured Markdown report:

```
EVPN health — <device or group>

BGP EVPN peers:
┌──────────────┬───────┬─────────────┬──────┬─────────┐
│   Neighbor   │  AS   │    State    │ Pfx  │ Up/Down │
├──────────────┼───────┼─────────────┼──────┼─────────┤
│ 10.255.0.1   │ 65000 │ Established │ 142  │ 3d04h   │
│ 10.255.0.2   │ 65000 │ ⚠ Active    │ —    │ 00:05   │
└──────────────┴───────┴─────────────┴──────┴─────────┘

VXLAN state:
- VTEPs: 4 discovered
- VNIs: 12 L2 + 2 L3 (VRF)
- Interface Vxlan1: up, source 10.255.0.0 (Loopback1)

VNI-VLAN mappings:
┌───────┬──────┬────────┐
│  VNI  │ VLAN │ Source │
├───────┼──────┼────────┤
│ 10010 │  10  │ static │
│ 10020 │  20  │ static │
│ 50000 │  —   │ VRF red│
└───────┴──────┴────────┘
```

Summary
- N devices checked
- M BGP EVPN peers (K not Established)
- P remote VTEPs, Q VNIs
- MAC address-table: R remote MACs, S with high move count
- Multihoming: T Ethernet Segments (U with DF issues)
- Any warnings (host-flap, sanity failures, missing routes)

End with a one-line summary even when everything is healthy.

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target
- Don't dump the full EVPN RIB by default — use route-type filters and only drill into specific types when needed
- Don't run all phases by default — start with Phase 1, drill into subsequent phases only when issues are found or the user asks
- Don't treat "EVPN not configured" errors as failures — not all devices run EVPN; omit them silently
- Don't confuse EVPN multicast (overlay) with PIM (underlay) — they're complementary; use check-pim-health for underlay PIM issues
