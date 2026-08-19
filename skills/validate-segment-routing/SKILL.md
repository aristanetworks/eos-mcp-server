---
name: validate-segment-routing
description: Validate ISIS Segment Routing health on Arista EOS devices via the eos MCP server. Reports ISIS-SR operational status, Node/Prefix/Adjacency SIDs learned, SRGB ranges, and TI-LFA protection state per device. Read-only — does not modify any device.
trigger: >
  When the user asks about SR in any form: "segment routing status", "SR health", "ISIS SR",
  "SID table", "prefix segments", "node SID", "adjacency SID", "SRGB", "SR tunnels",
  "TI-LFA", "SR labels", "MPLS labels for SR", "is SR working", "check SR", "show me SR",
  or any question mentioning segment-routing/SR/SID alongside a hostname, group, or "all" devices.
skip: >
  SR configuration changes (writes), SR theory/RFC questions unrelated to a live device, or non-Arista platforms.
allowed-tools: mcp__eos__eos_list_inventory, mcp__eos__eos_run_show
---

# Validate ISIS Segment Routing Health

Read-only audit of ISIS-SR state via the `eos` MCP server. Never call write tools or modify configuration.

## Resolving the Target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly, use it directly.
2. If unclear, call `mcp__eos__eos_list_inventory` first and ask the user to pick.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently.

## Commands

Issue in a **single** `mcp__eos__eos_run_show` call:

```
show isis summary
show isis segment-routing prefix-segments
show isis segment-routing adjacency-segments
show isis neighbors
```

If TI-LFA protection status is needed, follow up with:

```
show isis segment-routing tunnel
show isis ti-lfa path
```

Per-command errors for unconfigured features are normal — not a problem.

## Parsing

### ISIS-SR Status (from `show isis summary`)
- Instance name and VRF
- SR data-plane (MPLS)
- SR Router ID
- Whether SR is enabled or shutdown

### Prefix Segments (from `show isis segment-routing prefix-segments`)
For each prefix segment extract:
- **Prefix** — IP address/mask
- **SID Index** — the segment index
- **Type** — Node, Prefix, or Proxy-Node
- **Flags** — N (Node), P (no-PHP), E (Explicit-NULL), etc.
- **Origin** — System ID that originated the segment
- **Level** — L1 or L2
- **Algorithm** — SPF or Flex-Algo
- **Protection** — protected or unprotected

### Adjacency Segments (from `show isis segment-routing adjacency-segments`)
- **Adj IP Address** and **Local Interface**
- **SID** — label or index value
- **SID Source** — Configured or Dynamic
- **Flags** — F (IPv6), B (Backup), V (Value), L (Local)
- **Type** — P2P/LAN and level

### ISIS Neighbors (from `show isis neighbors`)
- **System ID** and **Interface**
- **State** — UP or other
- **Hold time** and **Circuit ID**

## Diagnosing Issues

| Symptom | Likely cause |
|---|---|
| SR not enabled | `segment-routing mpls` is shutdown or not configured |
| No prefix segments | No `node-segment` configured on loopbacks, or MPLS agent not started (`mpls ip`) |
| Missing remote SIDs | ISIS adjacency down, or remote device has SR disabled |
| Adjacency SID missing | Allocation mode set to `sr-peers` and peer doesn't support SR |
| SID conflicts | Two devices advertising same index for different prefixes — check `show tech-support ribd` SR Book Keeper section |
| Unprotected segments | TI-LFA not configured on interfaces (`isis fast-reroute ti-lfa`) |

## Output Format

Produce a markdown report per device:

```
## ISIS-SR Health — <device>

**Instance:** <name> | **VRF:** default | **SR Router ID:** <id> | **SRGB:** <base>-<base+size-1>

### Prefix Segments

| Prefix | SID | Type | Flags | Origin | Level | Protection | Algorithm |
|--------|-----|------|-------|--------|-------|------------|-----------|
| 1.1.1.1/32 | 1 | Node | N P | self | L2 | TI-LFA | SPF |
| 2.2.2.2/32 | 2 | Node | N P | LSR2 | L2 | unprotected | SPF |

### Adjacency Segments

| Interface | Adj IP | SID | Source | Flags | Type |
|-----------|--------|-----|--------|-------|------|
| Et1 | 10.0.0.1 | 100001 | Dynamic | — | P2P L2 |

### ISIS Neighbors

| System ID | Interface | State | Hold Time |
|-----------|-----------|-------|-----------|
| LSR2 | Et1 | UP | 28 |

**Summary:** X prefix SIDs learned, Y adjacency SIDs, Z/N neighbors UP
```

### Report rules:
- One report section per device
- Flag any prefix segments showing as `unprotected` with ⚠ if TI-LFA is expected
- Flag any missing or conflicting SIDs
- Flag neighbors not in UP state
- End with a **Summary** line: `X prefix SIDs, Y adjacency SIDs, Z/N neighbors UP`
- If all healthy: `✓ ISIS-SR fully operational — X prefix SIDs, Y adjacency SIDs, all neighbors UP`
