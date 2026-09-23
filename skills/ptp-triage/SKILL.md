---
author: Sakti Arunachalam
name: ptp-triage
description: Triage Arista EOS PTP synchronization, grandmaster, domain, delay, and offset symptoms and route to the correct PTP workflow. Read-only.
trigger: |
  TRIGGER for PTP not synchronizing, large or unstable offset, wrong or changing grandmaster, delay-response problems, PTP domain issues, or unclear PTP symptoms.
  SKIP for PTP configuration changes, unrelated multicast issues, or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Triage PTP symptoms

Classify the PTP mode and symptom, collect baseline state, and route to
`ptp-gm` or `ptp-debug`.

## Safety boundaries

- Use only the EOS MCP read-only tools listed above.
- Never change `ptp priority1`, `ptp priority2`, `ptp domain`, source IP,
  interface roles, or PTP enablement without explicit approval.
- Never disable PTP on a live interface or perform an EOS upgrade.
- Do not use Bash, `curl`, packet capture, or raw IP eAPI fallback unless the
  user explicitly authorizes that exact read-only action and endpoint.
- Keep credentials and complete packet captures out of the report.

## Questions and target resolution

Ask for PTP mode (Boundary, E2E/P2P Transparent Clock, or gPTP), domain,
expected GM, affected switch/interfaces, symptom, start time, transport, and
whether multicast/audio quality is also affected. Also record EOS version,
platform/SKU, PTP profile, and IPv4/IPv6/Layer-2 or unicast transport. If
targets are unclear, call `eos_list_inventory` and use inventory names or
groups.

Branch interpretation first by Boundary Clock versus Transparent Clock, L2
versus IPv4/IPv6, multicast versus unicast, and the PTP message class. Do not
apply ordinary IGMP/PIM/mroute conclusions to PTP management traffic.

## Initial checks

On the affected switch, run in one `eos_run_show` call:

```text
show ptp
show ptp local-clock
show ptp masters
show ptp source ip
show ptp monitor
show ptp interface
```

Healthy evidence is a stable expected GM, matching domain, valid source IP,
small stable offset, and expected PTP interface/port state. `show ptp monitor`
is historical/optional data; an empty monitor table is not proof that sync was
always unhealthy. Route as follows:

| Finding | Route |
| --- | --- |
| GM changes, wrong GM, or BMCA priority issue | `ptp-gm` |
| No delay responses, zero source IP, domain mismatch, or odd packet addressing | `ptp-debug` |
| Multicast audio/video quality may be PTP-related | `multicast-flow-drops` or `multicast-flow-corrupt` |

On the affected interface, collect counters only when needed:

```text
show ptp interface <interface> counters
show ptp interface <interface> counters drop
```

Use the `counters drop` form only when the target EOS release advertises it.
These are PTP-agent counters only; zero does not prove that ASIC, DMA, link,
CPU-queue, or physical loss is absent. Record counter age and whether a restart,
reboot, SSO, or upgrade may have reset them.
Treat the counters as valid for causal conclusions only when the counter epoch
is known and no restart, reboot, SSO, or hitless upgrade invalidated it. Some
hardware-forwarded unicast PTP traffic bypasses PTP-agent counters entirely.
Hard-gate interpretation by the supported mode/platform combination.
Interpret zero Delay_Req/Delay_Resp counters according to role and transport;
zero can be normal on a master, passive port, gPTP, or inactive interface.
Treat a source address of `0.0.0.0` as meaningful only after confirming IPv4
PTP transport. Domain comparisons must account for supported domain translation
or per-interface allowed-domain behavior.

Report facts, hypotheses, selected route, severity, and the next safe read-only
step. Do not treat one snapshot as proof of stability.
