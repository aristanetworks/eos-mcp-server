---
author: Suresh Kanagala
name: check-bgp-health
description: Audit BGP and EVPN neighbor health on Arista EOS devices via the eos MCP server. Returns a per-device table of neighbors with state, prefixes, and uptime, and flags every session that is not Established with a probable cause. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about BGP in any form, including: "BGP status", "BGP state", "BGP health", "BGP summary", "BGP neighbors", "BGP peers", "BGP sessions", "peering status", "peer state", "is BGP up", "are my BGP sessions up", "show me BGP", "check BGP", "EVPN neighbors", "EVPN peers", "EVPN status", "is the fabric up", "fabric health", "did the sessions come back up", "any flapping BGP", or any question mentioning bgp/evpn alongside a hostname, group, or "all" devices.

  SKIP when the request is about BGP configuration changes (writes), BGP theory/RFC questions unrelated to a live device, or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
  - mcp__eos__eos_get_facts
---

# Check BGP health on EOS devices

You are auditing BGP and BGP-EVPN neighbor state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about BGP health, status, state, peering, neighbors, peers, sessions, or "is the fabric up"
- The user asks about EVPN neighbor/peer state
- A device has connectivity issues and BGP is a likely cause
- After a maintenance window, to verify all sessions came back up

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`leaf1`, `SPINES`, `all`), use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently and the result is one consolidated response.

## Commands to run

Issue these in a **single** `mcp__eos__eos_run_show` call so the server fans out efficiently:

```
show ip bgp summary
show ipv6 bgp summary
show bgp evpn summary
```

Some devices won't have IPv6 BGP or EVPN configured — that's fine; the eAPI will return an error for the missing one(s) and the others will still succeed. Treat per-command errors as "feature not configured on this device," not as a fabric problem.

## Parsing the output

For each `show ... summary` response, extract per neighbor:
- Neighbor IPv4/IPv6 address
- AS number
- State (`Estab`, `Idle`, `Active`, `Connect`, `OpenSent`, `OpenConfirm`)
- PfxRcd (prefixes received — for Established sessions)
- Uptime (use this to flag flapping sessions — anything < 5 minutes deserves a note)

## Probable-cause hints for non-Established sessions

When a session is not Established, annotate it with a one-line cause hint:

| State | Likely cause |
|---|---|
| `Idle` | Peer down, locally administratively shut, or peer-group config issue |
| `Idle (Admin)` | Locally shut down via `shutdown` under the neighbor |
| `Active` | TCP reachable but no OPEN received — peer's BGP not running, ACL blocking, MD5 mismatch |
| `Connect` | TCP connection not yet established — routing/reachability issue or peer port closed |
| `OpenSent` / `OpenConfirm` | OPEN exchanged but capabilities mismatch — check AFI/SAFI, AS number, router-id collision |

For sessions stuck in non-Established state, optionally drill in with a **single follow-up** `mcp__eos__eos_run_show` call:

```
show ip bgp neighbors
```

…to get the last reset reason. Only do this if there are fewer than ~10 bad neighbors total — otherwise the output will be massive. If there are more, ask the user which one to investigate.

## When the BGP output is empty or the underlay is broken

If `show ... summary` returns empty output (no neighbors listed) rather than a "feature not configured" error, **or** overlay sessions are stuck `Idle`/`Active`/`Connect` with socket errors like *Network is unreachable*, investigate the following before reporting the device as healthy. Run these as concrete checks, not as hypotheses:

- **Recent config changes** on the device that may have removed neighbors or the BGP process.
- **Peer cross-reference.** Identify likely peer devices from the device's config (underlay/uplink interfaces, route-maps, peer-group references). If those peers are in the inventory, query them and compare what the expected peering should look like.
- **Syslog** on the device for BGP-related messages (process restarts, neighbor removals, session resets) that explain the empty state.
- **Routing table** — check `show ip route summary` and `show ipv6 route summary` to confirm the underlay is populating routes. Zero BGP routes with overlay sessions down is the hallmark of a broken underlay.
- **BFD state** — if BFD is configured for BGP, check `show bfd peers` for down/timeout diagnostics that pinpoint when the path broke.
- **Interface state** — check `show interfaces status` on the uplink interfaces; a down interface explains everything upstream.

## Output format

Always produce a Markdown report structured like this:

```
BGP health — <device or group>

┌──────────┬───────────┬───────┬─────────────┬──────┬────────┐
│ AFI/SAFI │ Neighbor  │  AS   │    State    │ Pfx  │ Uptime │
├──────────┼───────────┼───────┼─────────────┼──────┼────────┤
│ ipv4     │ 10.0.0.1  │ 65001 │ Established │ 142  │ 3d04h  │
│ ipv4     │ 10.0.0.2  │ 65001 │ ⚠ Idle      │ —    │ never  │
│ evpn     │ 10.0.0.10 │ 65000 │ Established │ 1287 │ 3d04h  │
└──────────┴───────────┴───────┴─────────────┴──────┴────────┘
```

Summary

- N devices checked
- M neighbors total
- K not Established (with probable cause per session)

End with the one-line summary even when everything is healthy (`✅ N devices, M neighbors, all Established`).

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target and let the server fan out
- Don't drill into per-neighbor detail for every device by default — only for the bad ones, and only if the count is small
- Don't treat "feature not configured" eAPI errors (e.g. no EVPN on a pure IP leaf) as fabric problems; just omit that section silently
