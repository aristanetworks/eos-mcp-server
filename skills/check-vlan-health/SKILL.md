---
author: Matthieu Tâche
name: check-vlan-health
description: Audit VLAN health on Arista EOS devices via the eos MCP server. Reports active/suspended/inactive VLAN status, port membership, SVI state, trunk configuration, MAC address table anomalies, and internal VLAN conflicts. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about VLANs in any form, including: "VLAN status", "VLAN health", "VLAN state", "VLAN check", "show vlan", "VLANs", "SVI status", "SVI state", "SVI down", "suspended VLAN", "inactive VLAN", "VLAN membership", "trunk VLANs", "allowed VLANs", "empty VLAN", "MAC address table", "VLAN ports", "VLAN not working", "VLAN missing", "which VLANs", or any question mentioning vlan/svi alongside a hostname, group, or "all" devices.

  SKIP when the request is about VLAN configuration changes (writes), VLAN theory, EVPN VXLAN overlay VLAN questions (use check-evpn-health instead), IGMP snooping per-VLAN issues (use check-igmp-health instead), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check VLAN health on EOS devices

You are auditing VLAN state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about VLAN status, suspended/inactive VLANs, or empty VLANs
- An SVI is down and the user wants to understand why
- After a maintenance window, to verify VLAN state
- Diagnosing L2 connectivity issues within a VLAN
- Auditing trunk configuration versus active VLANs
- Checking MAC address table counts per VLAN

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`leaf1`, `LEAVES`, `all`), use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently and the result is one consolidated response.

## Phase 1 — VLAN and SVI overview

Always run this phase. Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show vlan
show interfaces vlan brief
```

### Parsing `show vlan`

The JSON response contains a `vlans` dict keyed by VLAN ID string. For each VLAN extract:
- **`vlanId`** — integer VLAN ID
- **`name`** — VLAN name
- **`status`** — `"active"`, `"suspended"`, or `"inactive"`
- **`dynamic`** — boolean, true for dynamically created VLANs (e.g., MLAG, EVPN)
- **`interfaces`** — dict of member interfaces, each with a `blocked` boolean (STP blocking)

Flag:
- VLANs with `status` = `"suspended"` — traffic is blocked on this VLAN
- VLANs with `status` = `"inactive"` — VLAN exists but has no config entry
- Active VLANs with an empty `interfaces` dict — VLAN exists but has no active member ports
- Interfaces with `blocked: true` — STP is blocking traffic on that port

### Parsing `show interfaces vlan brief`

For each SVI (Vlan interface) extract:
- Interface name (e.g., `Vlan10`)
- Status (`up` or `down`)
- Protocol (`up` or `down`)
- IP address (if assigned)

Cross-reference with `show vlan`:
- An SVI that is `down/down` when its VLAN has no active ports in forwarding state is expected behavior (autostate)
- An SVI that is `down/down` when the VLAN has active forwarding ports suggests the SVI is administratively shut or misconfigured

## Phase 2 — Trunk and MAC analysis (conditional)

Only run when Phase 1 reveals issues (suspended VLANs, empty VLANs, SVIs down) or the user asks for detail. Issue in a **single** `mcp__eos__eos_run_show` call:

```
show interfaces trunk
show mac address-table count
show spanning-tree summary
```

### Parsing `show interfaces trunk`

For each trunk port extract:
- Allowed VLANs
- Active VLANs (VLANs actually forwarding on this trunk)

Flag:
- VLANs allowed on a trunk but not active — the VLAN doesn't exist on this device, is suspended, or STP is blocking
- Trunks with a very restrictive allowed-VLAN list that's missing expected VLANs

### Parsing `show mac address-table count`

Extract per-VLAN MAC address count.

Flag:
- Active VLANs with zero MACs — no hosts learned (cable unplugged, no traffic, or MAC aging)
- VLANs with unusually high MAC counts — potential L2 loop or broadcast storm

### Parsing `show spanning-tree summary`

Extract:
- STP mode (MSTP, RSTP, etc.)
- Number of blocked ports

Flag any blocked ports — may explain why a VLAN has no active forwarding members.

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| VLAN suspended | Administratively suspended via `state suspend` |
| SVI down/down with active L2 ports | SVI administratively shut (`shutdown` under `interface Vlan`) |
| SVI down/down with no L2 ports | No active L2 port in forwarding state — autostate brought SVI down |
| VLAN exists but no ports | VLAN created but no interfaces assigned to it, or all member ports are down |
| MAC flapping log messages | L2 loop or MLAG misconfiguration — check spanning-tree and MLAG state |
| Internal VLAN conflict | A routed port consumed a user VLAN ID — check `show vlan internal allocation` |
| Trunk allowed but not active | VLAN doesn't exist on one end of the trunk, is suspended, or STP is blocking |
| Zero MACs in active VLAN | No hosts learned — cable unplugged, no traffic, or MAC aging too aggressive |
| VLAN inactive | VLAN referenced but never explicitly created — no `vlan <id>` config |
| High MAC count in VLAN | Potential L2 loop, broadcast storm, or legitimate high-density segment |

## Output format

Always produce a Markdown report structured like this:

```
VLAN health — <device or group>

VLAN status:
┌──────┬──────────────┬───────────┬────────────────┬───────────┐
│ VLAN │     Name     │  Status   │     Ports      │ SVI State │
├──────┼──────────────┼───────────┼────────────────┼───────────┤
│  10  │ MGMT         │ ✅ active │ Et1, Et2, Po1  │ ✅ up/up  │
│  20  │ SERVERS      │ ✅ active │ Et3, Et4       │ ⚠ down    │
│  30  │ UNUSED       │ ✅ active │ —              │ —         │
│  99  │ QUARANTINE   │ ⚠ suspend │ —              │ —         │
└──────┴──────────────┴───────────┴────────────────┴───────────┘
```

Summary
- N VLANs total (A active, S suspended, I inactive)
- M SVIs configured (K up, J down)
- P VLANs with no active ports
- Any warnings (suspended VLANs, SVIs down, empty VLANs)

End with a one-line summary even when everything is healthy (`✅ N VLANs, all active, M SVIs up`).

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target and let the server fan out
- Don't run Phase 2 unless Phase 1 shows issues or the user requests detail
- Don't treat "VLAN not found" or empty VLAN tables as failures — not all devices use VLANs; omit silently
- Don't attempt to correlate VLANs across devices unless the user explicitly asks — this skill checks per-device state
- Don't include VLAN 1 warnings about no ports unless the user specifically asks about it — VLAN 1 is often unused by design
