---
author: Matthieu Tâche
name: check-pim-health
description: Audit PIM sparse-mode health on Arista EOS devices via the eos MCP server. Reports PIM neighbor adjacencies, interface state, RP election, multicast routing table with flag interpretation, and flags common failures including RPF errors, MLAG dual-PIM issues, VXLAN/EVPN overlay multicast, and anycast-RP. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about PIM in any form, including: "PIM status", "PIM health", "PIM neighbors", "PIM adjacency", "PIM interface", "PIM RP", "rendezvous point", "multicast routing", "mroute", "multicast route table", "multicast forwarding", "multicast not working", "source not reaching receivers", "SPT switchover", "RPF failure", "show pim", "show mroute", "PIM config-sanity", "anycast RP", "PIM MLAG", or any question mentioning pim/mroute/multicast-routing alongside a hostname, group, or "all" devices.

  SKIP when the request is about PIM configuration changes (writes), PIM protocol theory unrelated to a live device, IGMP-snooping-only questions (use check-igmp-health instead), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check PIM sparse-mode health on EOS devices

You are auditing PIM-SM (Protocol Independent Multicast — Sparse Mode) state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about PIM neighbors, RP status, multicast routes, or "is multicast routing working"
- Multicast traffic isn't reaching receivers despite IGMP being healthy
- After a maintenance window, to verify PIM adjacencies and RP election
- Diagnosing RPF failures, missing (S,G) or (*,G) state, or RP election problems
- Verifying PIM over MLAG, VXLAN/EVPN multicast overlay, or anycast-RP

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly, use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently.

## Phase 1 — Overview

Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show ip pim neighbor
show ip pim interface
show ip pim rp
show ip pim config-sanity
```

### Parsing the overview

**`show ip pim neighbor`** — for each neighbor, extract:
- Neighbor IP address
- Interface where discovered
- Uptime (how long the adjacency has been up)
- Expires (time until timeout — low values < 30s mean the neighbor is about to drop)
- Mode (typically `sparse`)

Flag any neighbor whose Expires is under 30 seconds, any interface where a neighbor is expected but missing, or any unexpected neighbor (e.g., VXLAN tunnel IPs appearing as PIM neighbors — this is a known bug where PIM hellos leak over VXLAN).

**`show ip pim interface`** — for each PIM-enabled interface, extract:
- Interface name and IP address
- Mode (`sparse`)
- Neighbor count (0 on a transit interface is a problem)
- DR address (who is the Designated Router)
- Packets queued / dropped (non-zero drops indicate congestion)

**`show ip pim rp`** — for each RP mapping, extract:
- Group range (e.g., `224.0.0.0/4`)
- RP address
- Uptime
- Expires (`never` = static RP, timer = dynamic via BSR)
- Priority

If **no RP is listed**, multicast will not work in sparse mode — this is a critical finding.

**`show ip pim config-sanity`** — automated check for common PIM configuration errors. Report any failures verbatim — this catches misconfigurations that are hard to spot manually (missing `software-forwarding sfe`, IGMP snooping querier conflicts with EVPN multicast, `pim ipv4 sparse-mode` on overlay VLANs in non-MLAG setups, etc.).

## Phase 2 — Multicast routing table (conditional)

Run this if Phase 1 shows healthy PIM adjacencies and RP, but the user reports multicast traffic issues:

```
show ip mroute
show ip mroute count
```

### Mroute flag reference

Each mroute entry carries flags that describe its state:

| Flag | Meaning |
|------|---------|
| **S** | SPT bit set — data on shortest path tree (normal steady state) |
| **E** | Forwarding on RPT (rendezvous point tree — initial state) |
| **J** | Joining to SPT (transitioning from RPT to SPT) |
| **R** | RPT bit set |
| **L** | Source is directly connected |
| **W** | Wildcard entry (*,G) |
| **X** | External component interest (IGMP, MSDP) |
| **C** | Learned from a DR via Register message |
| **A** | Learned via anycast-RP |
| **M** | Learned via MSDP |
| **Z** | Marked for deletion — transient during convergence, persistent Z = stuck state |
| **T** | Switching incoming interface — persistent T = route flapping |
| **K** | Keepalive timer not running |
| **B** | Learned via border router |

For each entry, extract:
- Group address
- Source address (or `*` for shared tree)
- Flags (see table above)
- Incoming interface (iif) — must match the RPF path to the source/RP
- RPF route — shows `[U]` (unicast RIB) or `[M]` (multicast RIB) with prefix, admin distance, metric
- Outgoing interface list (oif) — ports where data is forwarded
- Non-DR outgoing interface list — present when PIM fast-failover (`pim ipv4 non-dr install-oifs`) is active; indicates pre-installed OIFs with egress ACLs on the non-DR peer

### Key checks on mroute

1. **(*,G) exists but no (S,G)**: RP knows about the group but source data hasn't triggered SPT join, or source isn't sending
2. **(S,G) with empty oif list**: data arriving but no downstream receivers — check IGMP on receiver-facing interfaces
3. **iif is wrong (RPF failure)**: unicast routing to source/RP doesn't match incoming interface. Cross-check with `show ip route <source-or-rp-ip>`. The RPF route line (`[U]` vs `[M]`) tells you which RIB was used
4. **No mroute entries at all**: PIM joins aren't propagating — check RP reachability and neighbor adjacencies along the path
5. **Persistent Z flags**: entries stuck in deletion — indicates a software state issue
6. **Persistent T flags**: incoming interface keeps switching — indicates unicast route flapping affecting multicast
7. **`show ip mroute count` — packet counts**: if receiver counts are exactly 2x sender counts, double delivery is occurring (common MLAG issue)

## Phase 3 — Deep diagnostics (conditional)

Only run these for specific problems identified in Phase 1 or 2.

### RP election issues (dynamic RP via BSR)

```
show ip pim bsr
```

Verify a Bootstrap Router is active and distributing RP mappings. Key fields: BSR address, priority, hash mask length. If no BSR is elected, dynamic RP discovery fails entirely.

### Per-group RP verification

```
show ip pim rp-hash <group>
```

Confirms which RP is selected for a specific multicast group. Use this when traffic works for some groups but not others — different groups may hash to different RPs.

### RPF verification

When an mroute shows a suspicious incoming interface:

```
show ip route <source-ip>
```

The RPF interface must match the unicast route to the source. If the mroute's iif doesn't match, there's an RPF failure — traffic arrives on the wrong interface and is dropped.

### PIM protocol counters

```
show ip pim protocol counters
```

Look for:
- High Register message counts — source DR may be stuck encapsulating (RP not sending Register-Stop)
- Zero Join/Prune sent — PIM process may not be propagating joins
- High error counts — protocol-level issues

### Upstream join state

```
show ip pim upstream joins
```

Shows Join/Prune messages the device is scheduled to send upstream. Check that:
- Joins are going to the correct RPF neighbor
- No unexpected prunes for active groups
- Empty output when downstream receivers exist indicates a join propagation failure

### Register source

```
show ip pim register-source
```

Shows the interface whose IP is used in outbound PIM Register packets. Empty output means no `register local-interface` is configured — the source IP defaults to the best-route interface to the RP. If that interface goes down, Registers may carry an unexpected source IP.

### BFD status for PIM neighbors

```
show ip pim neighbor bfd
```

BFD flags per neighbor:
- **U** — BFD UP (healthy)
- **I** — BFD INIT (establishing)
- **D** — BFD DOWN (path failure detected)
- **N** — BFD not running

### Hardware forwarding cross-check

```
show ip mfib
```

Compare with `show ip mroute` to detect software/hardware state divergence. If mroute shows an (S,G) entry with an oif list but mfib doesn't have it programmed, traffic will be software-forwarded (slow path) or silently dropped.

### MLAG-specific checks

When the device is in an MLAG pair:

```
show mlag
show mlag config-sanity
```

For PIM fast-failover on the non-DR peer:

```
show pim ipv4 sparse-mode non-dr drop-rules
```

States:
- `active` — drop rules properly installed, non-DR ready for fast failover
- `inactive / Drop rule creation failed` — check platform support and TCAM
- `inactive / Drop rule programming failed on interface` — TCAM exhaustion
- `inactive / Multicast routes forwarding` — this peer became DR (normal after DR change)

### EVPN multicast overlay checks

When EVPN multicast is configured:

```
show bgp evpn instance
```

Verify `evpn multicast` is enabled in the VRF. Also confirm `software-forwarding sfe` is present under `router multicast` — missing this causes silent traffic loss.

For PIM External Gateway (PEG) status:

```
show ip pim vrf <vrf> sparse-mode evpn gateway detail
```

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| No PIM neighbors on an interface | PIM not enabled (`pim ipv4 sparse-mode`) on one or both sides, or L3 reachability broken |
| Neighbor Expires dropping to 0 | Hello messages not arriving — interface errors, ACL filtering, or one-sided PIM config |
| Unexpected PIM neighbor with VXLAN IP | PIM hellos leaking over VXLAN tunnel — known issue in some MLAG+VXLAN configs |
| No RP listed | Static RP not configured and BSR not active — sparse mode cannot function without an RP |
| Wrong RP selected for a group | BSR priority/hash mismatch, or static RP override not set — check `show ip pim rp-hash <group>` |
| (*,G) exists, no (S,G) | Source not sending, DR at source not PIM-enabled, or Register messages not reaching RP |
| (S,G) with empty oif | No downstream receivers — check IGMP on leaf/access interfaces |
| RPF failure (iif mismatch) | Unicast routing change moved the path to the source — PIM iif follows the unicast RIB |
| Traffic works for some groups, not others | Different groups may map to different RPs — check `show ip pim rp-hash` per group |
| Receiver getting duplicate packets (2x) | MLAG double delivery — traffic bridged to MLAG ports from peer-link. Check mroute oif lists |
| Slow failover on MLAG DR loss | Non-DR peer missing pre-installed OIFs — check `show pim ipv4 sparse-mode non-dr drop-rules` |
| PIM config-sanity fails on EVPN VLAN | `pim ipv4 sparse-mode` on overlay VLAN only supported with MLAG; use `ip igmp` + `pim ipv4 local-interface` in non-MLAG |
| Silent multicast loss with EVPN | Missing `software-forwarding sfe` under `router multicast` — required when `evpn multicast` is configured |
| No EVPN Type-6 routes with anycast-RP | Expected when MSDP/anycast-RP is used — inter-site shared trees are bypassed. Verify `show ip msdp sa-cache` instead |

## Output format

Produce a structured Markdown report:

```
PIM health — <device or group>

Config sanity: ✅ passed (or ⚠ N issues — list them)

PIM neighbors:
┌──────────────┬────────────┬────────┬─────────┬────────┐
│   Neighbor   │ Interface  │  Mode  │ Uptime  │ Expires│
├──────────────┼────────────┼────────┼─────────┼────────┤
│ 10.0.0.1     │ Ethernet1  │ sparse │ 3d04h   │ 01:25  │
│ 10.0.0.2     │ Ethernet2  │ sparse │ 3d04h   │ 01:28  │
│ 10.0.0.3     │ Vlan100    │ sparse │ ⚠ 00:02 │ 00:08  │
└──────────────┴────────────┴────────┴─────────┴────────┘

RP mappings:
┌───────────────┬─────────────┬────────┬─────────┬──────────┐
│  Group range  │     RP      │ Uptime │ Expires │ Priority │
├───────────────┼─────────────┼────────┼─────────┼──────────┤
│ 224.0.0.0/4   │ 10.255.0.1  │ 3d04h  │ never   │ 0        │
└───────────────┴─────────────┴────────┴─────────┴──────────┘

PIM interfaces:
┌────────────┬────────────┬────────┬───────────┬────────────────┐
│ Interface  │  Address   │  Mode  │ Neighbors │   DR address   │
├────────────┼────────────┼────────┼───────────┼────────────────┤
│ Ethernet1  │ 10.0.0.10  │ sparse │     1     │ 10.0.0.1       │
│ Vlan100    │ 10.1.0.1   │ sparse │     0     │ 10.1.0.1 (self)│
└────────────┴────────────┴────────┴───────────┴────────────────┘
```

Summary
- N devices checked
- M PIM neighbors total (K with issues)
- P RP mappings active
- Any warnings (no RP, missing neighbors, RPF failures, BFD down, config-sanity failures)

End with a one-line summary even when everything is healthy.

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target
- Don't dump the full mroute table by default — only inspect it when PIM adjacencies and RP are healthy but traffic isn't flowing
- Don't confuse PIM health (L3 multicast routing) with IGMP snooping health (L2) — they're complementary; use check-igmp-health for L2
- Don't treat "PIM not configured" errors as failures — not all devices run PIM; just omit them silently
- Don't run `show ip mroute` on devices with very large multicast tables without warning — it can trigger lock contention on large-scale deployments
