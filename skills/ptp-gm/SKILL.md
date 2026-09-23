---
author: Sakti Arunachalam
name: ptp-gm
description: Diagnose EOS PTP grandmaster election, BMCA, wrong-GM, and GM-oscillation problems using read-only MCP evidence.
trigger: |
  TRIGGER for a PTP grandmaster that oscillates, the wrong device becoming GM, BMCA priority questions, or unexpected clock election.
  SKIP for delay-response, source-IP, domain, or packet-addressing issues; use ptp-debug instead.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Diagnose PTP grandmaster election

Compare current GM state, local clock data, foreign masters, announce
behavior, and BMCA fields across the relevant devices.

## Safety boundaries

- Read-only EOS MCP tools only.
- Never change `ptp priority1`, `ptp priority2`, `ptp domain`, `ptp role
  master`, accepted grandmasters, or interface PTP enablement without explicit
  approval.
- Require explicit approval before presenting any configuration change as an
  action to take.
- Never disable PTP on a live interface, run traces, or use Bash/curl/packet
  capture without separate authorization for a named read-only action.
- Any proposed fix must state its fabric-wide impact and remain unexecuted.

## Evidence

Ask for expected/current GM, domain, affected devices, announce rates, and
recent changes. Also record EOS version, platform/SKU, PTP profile, and
transport. If needed, call `eos_list_inventory`. Collect:

```text
show ptp
show ptp masters
show ptp local-clock
show ptp foreign-master-record
show ptp monitor
show ptp interface <interface>
show ptp interface <interface> counters
show ptp interface <interface> counters drop
```

Use `ptp` running configuration only to verify the current state:

```text
eos_get_running_config(target="<switch>", section="ptp")
```

## BMCA analysis

Compare fields in order: Priority1, ClockClass, ClockAccuracy,
OffsetScaledLogVariance, Priority2, then Clock Identity. Lower values win;
Priority1 255 is commonly used for a device that must not become GM.

For oscillation, correlate GM changes with announce received counters, announce
interval/timeout compatibility, foreign-master records, and monitor offset
jumps. `show ptp monitor` is historical and may be empty or cleared; do not
treat it as a live counter. For a wrong GM, inspect forced `ptp role master`,
priorities, domain, and whether the intended GM appears in the foreign-master
record. An empty foreign-master record does not alone prove that no Announce
messages exist. A non-accepted GM drop is evidence of filtering, not proof
that the proposed allow-list change is safe. Inspect accepted-grandmaster
configuration only; never modify it in this skill.

Use `show ptp interface <interface> counters drop` only when supported by the
target EOS release. Domain comparisons must account for supported domain
translation or per-interface allowed-domain behavior.

## Report

Report current and expected GM identity, BMCA fields, announce/counter state,
domain, forced roles, accept-list evidence, offset behavior, confidence, and
approval-required recommendations. Escalate when BMCA evidence is correct but
election remains unstable or the port state machine is stuck.
