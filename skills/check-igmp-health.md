---
author: Matthieu Tâche
name: check-igmp-health
description: Audit IGMP snooping health on Arista EOS devices via the eos MCP server. Reports global snooping state, per-VLAN status, querier election, group membership, multicast router ports, IGMP counters, and flags common failures including MLAG sync issues, VXLAN/EVPN multicast edge cases, and missing queriers. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about IGMP in any form, including: "IGMP status", "IGMP health", "IGMP snooping", "IGMP groups", "multicast groups", "multicast snooping", "mrouter ports", "multicast router ports", "IGMP querier", "who is the querier", "multicast flooding", "multicast not working", "receivers not getting multicast", "show igmp", "snooping pruning", or any question mentioning igmp/snooping/multicast-groups alongside a hostname, group, or "all" devices.

  SKIP when the request is about IGMP configuration changes (writes), IGMP protocol theory unrelated to a live device, PIM-specific questions (use check-pim-health instead), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check IGMP snooping health on EOS devices

You are auditing IGMP snooping state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about IGMP snooping status, multicast group membership, or querier state
- Multicast traffic is flooding or not reaching receivers
- After a maintenance window, to verify IGMP snooping is operational
- Diagnosing why a host is or isn't receiving a multicast stream
- Verifying IGMP snooping behavior in MLAG, VXLAN, or EVPN multicast deployments

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly, use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently.

## Phase 1 — Overview

Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show ip igmp snooping
show igmp snooping querier
show ip igmp snooping groups
```

### Parsing the overview

**`show ip igmp snooping`** — check per VLAN:
- Global IGMP snooping: Enabled or Disabled
- Per-VLAN snooping status
- **`IGMP snooping pruning active`**: if `False`, multicast is flooding the VLAN — almost always means no querier is detected
- **`Flooding traffic to VLAN`**: if `True`, multicast is being flooded rather than selectively forwarded — the most common symptom operators notice
- **`EVPN proxy active`**: should be `True` when EVPN multicast is configured; `False` indicates a configuration mismatch
- Report flooding status
- Immediate leave (fast-leave) status

**`show igmp snooping querier`** — for each VLAN, extract:
- VLAN ID
- Querier IP address
- IGMP version (v2 or v3)
- Port where the querier is seen

**Critical: no querier = no pruning.** This is the single most common root cause of IGMP snooping failures. Without a querier, snooping cannot age out group state, and pruning goes inactive, causing all multicast to flood.

**`show ip igmp snooping groups`** — for each entry, extract:
- VLAN
- Multicast group address
- Member ports (interfaces receiving traffic for this group)
- In VXLAN-aware snooping, remote VTEPs appear as members with an `(IR)` (Ingress Replication) tag

## Phase 2 — Drill-down (conditional)

Only run these if Phase 1 reveals issues or the user asks for detail.

### Missing or wrong multicast router ports

```
show ip igmp snooping mrouter detail
```

Check that at least one mrouter port exists per VLAN where multicast is expected. Types:
- `querier` — learned from IGMP queries
- `pim` — learned from PIM hellos
- `static` — manually configured

If no mrouter port exists, multicast traffic from the router won't reach the VLAN's snooping table.

### IGMP message counters

```
show ip igmp snooping counters
```

Look for:
- **Queries = 0 on all ports**: no querier is active — IGMP membership will eventually time out
- **Reports = 0 on all ports**: hosts are not sending IGMP reports, or reports are not being trapped to the CPU
- **Reports on a port but group not in snooping table**: possible version mismatch or filtering
- **High error count**: packet corruption, MTU issues, or misconfigured IGMP version
- **VTEP ports showing zero Reports**: in VXLAN-aware snooping, VXLAN-encapsulated IGMP packets are not being trapped to the snooping agent

### MLAG snooping sync state (EOS 4.32.2+)

```
show ip igmp snooping mlag
```

Check:
- **Connection state**: must be `Connected`
- **Mount state**: must be `Mounted`

If either shows `Disconnected` or `Not Mounted`, the TCP connection between snooping agents on the MLAG peers has failed. This is a **Sev-1 issue** — snooping state is not replicated between peers, leading to multicast traffic loss on failover. Most common cause: a custom control-plane ACL blocking TCP ports 5541 (IGMP) and 5542 (MLD).

### Configuration consistency (EOS 4.32.2+)

```
show configuration consistency igmp snooping
```

Detects misconfigurations such as having both an L2 snooping querier and an L3 IGMP router querier on the same VLAN (they don't see each other's queries, causing election issues).

### EVPN-learned multicast groups

When EVPN multicast is configured:

```
show ip igmp snooping groups local
show ip igmp snooping groups evpn
```

- `local` — groups learned from directly attached hosts
- `evpn` — groups learned from remote PEs via SMET (Type-6) routes. Member port shows as `PIM-Tunnel` (underlay multicast) or `IR` (ingress replication)

### Routed IGMP (L3 interfaces)

If the device is an L3 multicast router (not just an L2 snooping switch):

```
show ip igmp interface
show ip igmp groups
```

**`show ip igmp interface`** — for each interface:
- IGMP enabled/disabled
- Multicast routing enabled/disabled
- IGMP version (must match hosts)
- Querier address
- Query interval and response time

**`show ip igmp groups`** — connected group membership on routed interfaces:
- Group address, interface, uptime/expires, last reporter IP

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| Multicast flooding entire VLAN | No querier present — snooping pruning goes inactive. Configure an L2 querier per VLAN or ensure PIM router is providing queries |
| `pruning active: False` | Same as above — no querier detected within the VLAN |
| No groups in snooping table | No IGMP reports received — hosts not joining, or reports filtered/dropped. Check counters for errors |
| No mrouter port on VLAN | PIM not enabled on the router's VLAN interface, or router's IGMP queries not reaching the switch |
| Querier shows a different device | Another device with a lower IP is winning the querier election — expected unless misconfigured |
| Group membership expires quickly | Querier interval too long, robustness variable too low, or host stopped sending reports |
| IGMPv3 groups not learned | Switch or querier running IGMPv2 — version mismatch. Source filtering is lost with IGMPv2 |
| Multicast works on some ports, not others | Check snooping group member list — missing ports haven't sent IGMP reports |
| MLAG sync `Disconnected` | Custom control-plane ACL blocking TCP 5541/5542. Add permit rules for those ports with `ttl eq 255` |
| Groups drop after MLAG peer reload | Known transient — snooping entries are flushed on the primary and relearned over the next query interval |
| Group count > 0 but group table empty | Known display inconsistency on MLAG primary after all leaves are sent |
| `EVPN proxy active: False` | Missing `redistribute igmp` under BGP MAC-VRF, or `evpn multicast` under VRF for IRB |
| Remote VTEP members missing from groups | SMET routes not being received/imported — check RT configuration and `show bgp evpn route-type smet` |
| CPU load from IGMP with snooping disabled on EVPN VXLAN | Known bug on Sand platforms (EOS 4.27-4.31) — IGMP packets punted to CPU even with snooping disabled |
| L2 + L3 querier on same VLAN | They don't see each other's queries, causing election issues. Only configure one per VLAN |

## Output format

Produce a structured Markdown report:

```
IGMP health — <device or group>

Global: IGMP snooping Enabled, robustness 2

Per-VLAN status:
┌──────┬──────────┬─────────┬──────────────────┬────────┐
│ VLAN │ Snooping │ Pruning │     Querier      │ Groups │
├──────┼──────────┼─────────┼──────────────────┼────────┤
│ 100  │ Enabled  │ Active  │ 10.1.1.1 (v2/Et3)│   3    │
│ 200  │ Enabled  │ ⚠ no    │ ⚠ none           │   0    │
└──────┴──────────┴─────────┴──────────────────┴────────┘

Groups (VLAN 100):
┌─────────────┬─────────────────┐
│    Group    │     Members     │
├─────────────┼─────────────────┤
│ 225.1.1.1   │ Et1, Et2, Et3   │
│ 225.1.1.2   │ Et1, Cpu        │
└─────────────┴─────────────────┘
```

Summary
- N devices checked
- M VLANs with snooping enabled
- K groups learned
- Any warnings (no querier, no mrouter, snooping disabled, MLAG sync issues)

End with a one-line summary even when everything is healthy.

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target
- Don't dump full counter tables unless the user asks — summarize anomalies only
- Don't confuse IGMP snooping (L2) with IGMP on routed interfaces (L3) — check both when the device is a multicast router
- Don't treat "IGMP snooping not configured" errors as failures — not all VLANs need snooping; omit silently
