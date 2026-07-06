---
author: Matthieu Tâche
name: check-interface-health
description: Audit interface health on Arista EOS devices via the eos MCP server. Reports link status (connected, notconnect, disabled, errdisabled), error counters (FCS, alignment, symbol, runts, giants), error-disabled ports with reasons, traffic rates, discards, and transceiver DOM readings. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about interfaces in any form, including: "interface status", "interface health", "interface state", "interface errors", "port status", "link status", "link state", "error counters", "CRC errors", "FCS errors", "error disabled", "errdisabled", "err-disabled", "port down", "interface down", "show interfaces", "transceiver", "optics", "DOM", "traffic rate", "utilization", "discards", "drops", "runts", "giants", "symbol errors", "alignment errors", "which ports are up", "which ports are down", or any question mentioning interface/port/link alongside a hostname, group, or "all" devices.

  SKIP when the request is about interface configuration changes (writes), interface theory, EVPN/VXLAN overlay questions (use check-evpn-health instead), BGP peering issues (use check-bgp-health instead), or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check interface health on EOS devices

You are auditing interface state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill
- The user asks about interface status, link state, or error counters
- Ports are down or error-disabled and the user wants to know why
- Diagnosing physical layer problems (CRC errors, optics, cables)
- After a maintenance window, to verify all expected links are up
- Checking traffic rates or interface utilization
- Investigating packet drops or discards

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`leaf1`, `SPINES`, `all`), use it directly.
2. If the target is unclear or missing, **first call `mcp__eos__eos_list_inventory`** and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently and the result is one consolidated response.

## Phase 1 — Status and error overview

Always run this phase. Issue these in a **single** `mcp__eos__eos_run_show` call:

```
show interfaces status
show interfaces counters errors
```

### Parsing `show interfaces status`

The JSON response contains an `interfaceStatuses` dict keyed by interface name. For each interface extract:
- **Interface name** (e.g., `Ethernet1`)
- **Description** (link name)
- **Link status** — `connected`, `notconnect`, `disabled`, `errdisabled`
- **VLAN** — access VLAN or `trunk`
- **Duplex** — `full`, `half`, or `auto`
- **Speed** — link speed
- **Type** — transceiver type (e.g., `10GBASE-SR`, `Not Present`)

Count interfaces by status category:
- `connected` — link up and operational
- `notconnect` — enabled but no link (cable unplugged, peer down, optic missing)
- `disabled` — administratively shut down
- `errdisabled` — disabled by EOS due to a detected fault

Flag any `errdisabled` ports — the link status string often includes the reason (e.g., `errdisabled` with additional context in the `linkStatus` field or via `show interfaces status errdisabled`).

### Parsing `show interfaces counters errors`

The JSON response contains an `interfaceErrorCounters` dict. For each interface extract:
- **FCS** — Frame Check Sequence (CRC) errors
- **alignmentErrors** — alignment errors
- **symbolErrors** — encoding symbol errors
- **rxTotalErrors** — total receive errors
- **runts** — undersized frames (< 64 bytes)
- **giants** — oversized frames
- **txTotalErrors** — total transmit errors

Flag any interface with non-zero error counters. Omit management interfaces (Management0, Management1) from error analysis unless the user specifically asks — management ports often show benign counters.

## Phase 2 — Rates and discards (conditional)

Only run when Phase 1 shows errors or errdisabled ports, or the user asks for traffic analysis. Issue in a **single** `mcp__eos__eos_run_show` call:

```
show interfaces counters rates
show interfaces counters discards
```

### Parsing `show interfaces counters rates`

For each interface extract:
- Input/output rate in bits per second
- Input/output packets per second

Flag interfaces with utilization above 80% (calculate from the rate versus the interface speed obtained in Phase 1). High utilization indicates potential congestion.

### Parsing `show interfaces counters discards`

For each interface extract:
- **Input discards** — packets dropped on ingress
- **Output discards** — packets dropped on egress

Flag any non-zero discard counters:
- High input discards suggest storm control, ingress ACL drops, or input queue overflow
- High output discards suggest egress congestion (queue overflow), commonly caused by microbursts or sustained oversubscription

## Phase 3 — Per-interface and optics deep dive (optional, on request)

Only run for specific interfaces the user names, or when Phase 1/2 identified problematic ports.

### Detailed per-interface statistics

```
show interfaces <intf>
```

Full statistics for a specific interface: counters (packets, bytes, errors, discards), last state change, bandwidth, MTU, duplex/speed negotiation, and detailed error breakdown (CRC, alignment, symbol, runts, giants, collisions, late collisions, deferred).

### Transceiver DOM readings

```
show interfaces transceiver
```

For each transceiver extract:
- **Temperature** (°C) — flag above 70°C (most transceivers' rated maximum)
- **Voltage** (V) — flag out of specification range
- **Tx power** (dBm) — transmit optical power
- **Rx power** (dBm) — receive optical power

Flag:
- Rx power below -30 dBm — below typical receiver sensitivity; dirty fiber, bad splice, or excessive distance
- Rx power at 0.0 dBm or N/A — no light received; fiber disconnected or far-end transceiver off/missing
- Temperature above transceiver rated maximum — risk of transceiver shutdown or data errors
- Any alarm flags if reported (Tx fault, Rx LOS, CDR LOL)

## Probable-cause hints

| Symptom | Likely cause |
|---|---|
| errdisabled (bpduguard) | BPDU received on a portfast/edge port — host port has a switch or bridge behind it |
| errdisabled (link-flap) | Link flapped too many times within the detection window |
| errdisabled (portsec) | Port security violation — more MACs than allowed |
| FCS / CRC errors | Bad cable, dirty fiber connector, faulty transceiver, or electromagnetic interference |
| Alignment errors | Faulty NIC, duplex mismatch, or cable issue |
| Symbol errors | Faulty transceiver, PHY issue, or cable exceeding distance rating |
| Runts | Collision on half-duplex link, faulty NIC, or upstream device sending undersized frames |
| Giants | MTU mismatch — one side configured for jumbo frames, the other not |
| High input discards | Storm control, ingress ACL dropping traffic, or input queue overflow |
| High output discards | Egress congestion — queue overflow from microbursts or sustained oversubscription |
| notconnect | Cable unplugged, peer interface down, transceiver missing, or auto-negotiation failure |
| disabled | Interface administratively shut down |
| Low Rx power (< -30 dBm) | Dirty fiber, bad splice, excessive distance, or failing transceiver |
| Rx power N/A or 0 | No light received — fiber disconnected at far end, or far-end transceiver off/missing |
| High temperature (> 70°C) | Insufficient airflow, ambient temperature too high, or transceiver approaching end of life |
| Late collisions | Duplex mismatch or cable length exceeding specification |

## Output format

Always produce a Markdown report structured like this:

```
Interface health — <device or group>

Status summary:
┌──────────────┬───────┐
│    Status    │ Count │
├──────────────┼───────┤
│ ✅ connected │   42  │
│ notconnect   │    6  │
│ disabled     │    2  │
│ ⚠ errdisabled│    1  │
└──────────────┴───────┘

Error-disabled ports (if any):
┌──────────┬──────────────┬──────────────┐
│   Port   │   Reason     │ Description  │
├──────────┼──────────────┼──────────────┤
│ Et15     │ bpduguard    │ to-server-7  │
└──────────┴──────────────┴──────────────┘

Error counters (non-zero only):
┌──────────┬──────┬───────┬────────┬───────┬────────┬──────┐
│   Port   │ FCS  │ Align │ Symbol │ Runts │ Giants │  Tx  │
├──────────┼──────┼───────┼────────┼───────┼────────┼──────┤
│ Et3      │  142 │   0   │    0   │   0   │    0   │   0  │
│ Et7      │    0 │   0   │    0   │   0   │   23   │   0  │
└──────────┴──────┴───────┴────────┴───────┴────────┴──────┘
```

If all error counters are zero, state `✅ All error counters zero` instead of an empty table.

Summary
- N interfaces total (A connected, B notconnect, C disabled, D errdisabled)
- E interfaces with non-zero error counters
- Any warnings (errdisabled ports with reasons, high error counts, utilization alerts)

End with a one-line summary even when everything is healthy (`✅ N interfaces, A connected, all error counters zero`).

## Don't
- Don't try config changes — this skill is read-only
- Don't call `mcp__eos__eos_run_show` once per device; use a group target and let the server fan out
- Don't dump full `show interfaces` output for all ports — use `status` and `counters` summaries; only drill into specific ports in Phase 3
- Don't include management interfaces (Management0/1) in error analysis unless the user specifically asks — management ports often show benign counters
- Don't run `show interfaces transceiver` by default — it can be slow on large chassis; only run when optic issues are suspected or the user asks
- Don't treat "not configured" errors as failures — omit silently
- Don't report `notconnect` as a problem unless the user asks — many ports are intentionally unconnected
