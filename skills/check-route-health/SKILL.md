---
author: Matthieu Tâche
name: check-route-health
description: Audit routing table and VRF health on Arista EOS devices via the eos MCP server. Reports VRF state (routing enabled, protocols, interfaces), per-protocol route counts (connected, static, BGP, OSPF), protocol neighbor cross-checks, and hardware FIB resource usage. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about routing or VRFs in any form, including: "route health", "routing table", "route summary", "route count", "VRF status", "VRF state", "VRF health", "ip route", "show ip route", "routing protocol status", "no routes", "empty routing table", "missing routes", "route missing", "FIB", "hardware resources", "RIB", "VRF not routing", "show vrf", "how many routes", "routing convergence", "route table", or any question mentioning routes/routing/vrf alongside a hostname, group, or "all" devices.

  SKIP when the request is about routing configuration changes (writes), routing protocol theory, BGP-specific neighbor debugging (use check-bgp-health instead), EVPN route-type analysis (use check-evpn-health instead), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check routing and VRF health on EOS devices

You are auditing routing table and VRF state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about route counts, missing routes, or VRF state
- Verifying VRFs have routing enabled (`ip routing vrf`)
- After a maintenance window, to verify routing convergence
- Diagnosing reachability problems at the routing layer
- Checking whether protocol routes are populating as expected
- Investigating hardware FIB resource exhaustion

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`spine1`, `LEAVES`, `all`), use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently and the result is one consolidated response.

## Phase 1 — VRF and route overview

Always run this phase. Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show vrf
show ip route summary
show ip route vrf all summary
```

### Parsing `show vrf`

For each VRF extract:
- **VRF name**
- **Route Distinguisher (RD)** — may be empty for non-EVPN/MPLS VRFs
- **Protocols** — `ipv4`, `ipv6`, or `ipv4,ipv6`
- **State** — `routing` or `no routing`
- **Interfaces** — list of member interfaces

Flag:
- VRFs with state `no routing` — `ip routing vrf <name>` is not configured; the VRF will not forward routed traffic. This is the most common VRF misconfiguration
- VRFs with no interfaces assigned — the VRF is empty or all member interfaces are down
- VRFs showing only `ipv4` when IPv6 routes are expected — `ipv6 unicast-routing vrf <name>` is missing

### Parsing `show ip route summary`

Extract the default VRF route counts broken down by source:
- Connected, Static, BGP (External/Internal), OSPF (Intra-area/Inter-area/External), ISIS, RIP, aggregate, etc.
- Total route count

Flag:
- Zero total routes — no routes in the FIB
- A protocol source showing 0 routes when routes are expected (e.g., BGP = 0 when peers should be advertising)

### Parsing `show ip route vrf all summary`

Same breakdown per VRF. Cross-reference with `show vrf`:
- A VRF that lists a protocol (e.g., BGP in protocols) but has zero routes from that protocol — the protocol is enabled but not populating routes
- A VRF with `routing` state but zero total routes — interfaces may be down or protocol neighbors are not established

## Phase 2 — Protocol neighbor cross-check (conditional)

Only run when Phase 1 reveals VRFs with zero protocol routes, unexpected route counts, or the user asks for detail. Issue in a **single** `mcp__eos__eos_run_show` call:

```
show ip bgp summary vrf all
show ip ospf neighbor vrf all
```

Some devices won't have BGP or OSPF configured — that's fine; treat per-command errors as "feature not configured on this device" and omit silently.

### Parsing `show ip bgp summary vrf all`

For each VRF with BGP, extract per neighbor:
- Neighbor address, AS, State, PfxRcd, PfxAcc

Flag:
- Non-Established sessions — the BGP peer is not up. Use the cause hints from `check-bgp-health` if more detail is needed
- Established sessions with PfxRcd = 0 — peer is up but advertising no routes
- Cross-reference: VRF has zero BGP routes (from Phase 1) AND no Established peers = BGP is misconfigured in this VRF

### Parsing `show ip ospf neighbor vrf all`

For each VRF with OSPF, extract per neighbor:
- Neighbor ID, State, Interface

Flag:
- Non-FULL adjacencies (except 2-WAY on multi-access segments with non-DR/BDR, which is expected)
- Cross-reference: VRF has zero OSPF routes (from Phase 1) AND no FULL neighbors = OSPF is misconfigured in this VRF

## Phase 3 — Deep diagnostics (optional, on request)

Only run when the user asks for a specific prefix investigation or hardware resource check.

### Specific prefix lookup

```
show ip route vrf <name> <prefix>
```

Extract: route source, next-hop, interface, administrative distance, metric. If the prefix is missing, state that it does not exist in the VRF's routing table.

### Hardware FIB resource check

```
show hardware capacity utilization table routing
```

Flag:
- Usage above 80% — approaching hardware limits, new routes may fail to be programmed
- Any "failed" or "overflow" entries — routes exist in the RIB but are not programmed in the forwarding plane

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| VRF shows "no routing" | `ip routing vrf <name>` not configured |
| VRF missing IPv6 | `ipv6 unicast-routing vrf <name>` not configured |
| Zero BGP routes in VRF | BGP sessions not Established, no prefixes advertised, or route-map filtering all |
| Zero OSPF routes in VRF | OSPF neighbors not FULL, areas misconfigured, or networks not advertised |
| Protocol listed but no routes | Protocol enabled but no neighbors established, no networks configured, or redistribute missing |
| Empty VRF route table | Interfaces not assigned to VRF, or all member interfaces are down |
| Connected routes missing | Interface in VRF is down or has no IP address configured |
| Default route missing | No static default, no BGP/OSPF default-originate, or filtered by route-map |
| High FIB utilization | Route scale approaching hardware limits — consider route aggregation or profile change |
| Routes in RIB but not in FIB | Hardware resource exhaustion — traffic to unprogrammed destinations will be software-switched or dropped |

## Output format

Always produce a Markdown report structured like this:

```
Route health — <device or group>

VRF status:
┌──────────┬────────────┬───────────┬────────────┬─────────────┬────────┐
│   VRF    │     RD     │   State   │ Protocols  │ Interfaces  │ Routes │
├──────────┼────────────┼───────────┼────────────┼─────────────┼────────┤
│ default  │ —          │ ✅ routing│ BGP, OSPF  │ Et1-4, Lo0  │  142   │
│ PROD     │ 10.0.0.1:1 │ ✅ routing│ BGP        │ Vl10, Vl20  │   38   │
│ MGMT     │ —          │ ⚠ no rtg  │ —          │ Ma1         │    2   │
└──────────┴────────────┴───────────┴────────────┴─────────────┴────────┘

Route summary:
┌──────────┬───────────┬────────┬──────┬──────┬───────┬───────┐
│   VRF    │ Connected │ Static │ BGP  │ OSPF │ Other │ Total │
├──────────┼───────────┼────────┼──────┼──────┼───────┼───────┤
│ default  │     8     │   1    │  120 │  13  │   0   │  142  │
│ PROD     │     4     │   0    │   34 │   0  │   0   │   38  │
│ MGMT     │     1     │   1    │   0  │   0  │   0   │    2  │
└──────────┴───────────┴────────┴──────┴──────┴───────┴───────┘
```

Summary
- N VRFs (M routing, K not routing)
- T total routes across all VRFs
- Any warnings (no-routing VRFs, empty route tables, protocol mismatches)

End with a one-line summary even when everything is healthy (`✅ N VRFs, all routing, T total routes`).

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target and let the server fan out
- Don't run `show ip route vrf all` (full table) by default — use `summary` variants; full tables can be enormous and overwhelm the output
- Don't run Phase 3 hardware checks unless the user specifically asks or Phase 1/2 suggest resource issues
- Don't treat "VRF not found" or "no routing process" errors as failures — not all devices use VRFs or dynamic protocols; omit silently
- Don't drill into per-prefix detail unless the user names a specific prefix to investigate
- Don't duplicate BGP neighbor debugging already covered by `check-bgp-health` — reference that skill for deep BGP analysis
