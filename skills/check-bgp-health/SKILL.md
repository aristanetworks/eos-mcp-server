---
name: check-bgp-health
description: Audit BGP and EVPN neighbor health on Arista EOS devices via the eos MCP server. Returns a per-device table of neighbors with state, prefixes, and uptime, and flags every session that is not Established with a probable cause. Read-only — does not modify any device.
trigger: >
  When the user asks about BGP in any form: "BGP status/state/health/summary/neighbors/peers/sessions",
  "peering status", "is BGP up", "EVPN neighbors/peers/status", "is the fabric up", "fabric health",
  "did the sessions come back up", "any flapping BGP", or any question mentioning bgp/evpn alongside
  a hostname, group, or "all" devices.
skip: >
  BGP configuration changes (writes), BGP theory/RFC questions unrelated to a live device, or non-Arista platforms.
allowed-tools: mcp__eos__eos_list_inventory, mcp__eos__eos_run_show
---

# Check BGP Health on EOS Devices

Read-only audit of BGP and BGP-EVPN neighbor state via the `eos` MCP server. Never call write tools or modify configuration.

## Resolving the Target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`leaf1`, `CUSTOMER_LAB`, `all`), use it directly.
2. If the target is unclear, call `mcp__eos__eos_list_inventory` first and ask the user to pick.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently.

## Commands

Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show ip bgp summary
show ipv6 bgp summary
show bgp evpn summary
```

Per-command errors for missing features (no IPv6 BGP, no EVPN) are normal — not a fabric problem.

## Parsing

For each neighbor extract:
- **Neighbor** — IPv4/IPv6 address
- **AS** — remote AS number
- **State** — `Estab`, `Idle`, `Active`, `Connect`, `OpenSent`, `OpenConfirm`
- **PfxRcd** — prefixes received (Established sessions only)
- **Uptime** — flag anything < 5 minutes as potential flapping

## Diagnosing Non-Established Sessions

| State | Likely cause |
|---|---|
| `Idle` | Peer down, admin shut, or peer-group config issue |
| `Idle (Admin)` | Locally shut via `shutdown` under the neighbor |
| `Active` | TCP reachable but no OPEN — peer's BGP not running, ACL blocking, MD5 mismatch |
| `Connect` | TCP not established — routing/reachability issue or peer port closed |
| `OpenSent` / `OpenConfirm` | Capabilities mismatch — check AFI/SAFI, AS number, router-id collision |

For non-Established sessions, drill in with a follow-up `mcp__eos__eos_run_show`:

```
show ip bgp neighbors <neighbor-ip>
```

This retrieves the last reset reason. Only do this for < 10 bad neighbors — otherwise ask the user which to investigate.

## Empty BGP Output

If `show ... summary` returns no neighbors (not a "feature not configured" error), investigate before declaring healthy:

- Check for recent config changes that may have removed neighbors or the BGP process
- Identify likely peers from the device config (underlay interfaces, peer-group references) and query those peers if they're in inventory
- Check syslog for BGP-related messages (process restarts, neighbor removals, session resets)

## Output Format

Produce a markdown report per device:

```
## BGP Health — <device or group>

| AFI/SAFI | Neighbor  | AS    | State       | PfxRcd | Uptime |
|----------|-----------|-------|-------------|--------|--------|
| ipv4     | 10.0.0.1  | 65001 | Established | 142    | 3d04h  |
| ipv4     | 10.0.0.2  | 65001 | ⚠ Idle      | —      | never  |
| evpn     | 10.0.0.10 | 65000 | Established | 1287   | 3d04h  |

**Summary:** 2/3 Established, 1 down

### ⚠ Issues
- **10.0.0.2** (ipv4, AS 65001) — Idle. Probable cause: peer down or admin shut. Last reset reason: <from drill-in>.
```

### Report rules:
- One table per device, grouped by AFI/SAFI
- Mark non-Established sessions with ⚠
- Flag sessions with uptime < 5 minutes as **Flapping**
- End with a **Summary** line: `X/Y Established, Z down`
- List all issues with probable cause and last reset reason (if retrieved)
- If all sessions are Established: `✓ All N sessions healthy`
