---
author: Sakti Arunachalam
name: multicast-flow-corrupt
description: Diagnose corrupted, duplicated, mixed, or packet-losing EOS multicast flows using interface, hardware, CoPP, MMU, IGMP, PIM, MFIB, RPF, and PTP evidence. Read-only.
trigger: |
  TRIGGER for broken video/audio, artifacts, mixed multicast content, duplicate packets, packet loss, or corrupted multicast flows.
  SKIP for a flow that is entirely absent, intermittent IGMP drops, bandwidth-only anomalies, pure IGMP/PIM health, configuration changes, or MCS/SDN-managed flows.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Diagnose multicast flow corruption

Locate loss, duplication, aliasing, or wrong-content symptoms along the path.
Separate packet loss from multiple sources, L2/L3 replication, address
aliasing, or PTP timing in audio/video deployments.

## Safety boundaries

- Read-only EOS MCP tools only. Never change multicast, IGMP, PIM, ACL, CoPP,
  platform, or PTP configuration.
- Never clear mroute state, restart agents, run traces, or apply a write.
- Bash, tcpdump, and curl are not automatic fallbacks. Use them only after the
  user explicitly authorizes the named read-only command and endpoint; protect
  credentials and payload data.
- Do not use `clear ip mroute *`, disable snooping, add static groups, or apply
  platform workarounds without explicit approval.

## Inputs and evidence

Ask for source/receiver switches and interfaces, `(S,G)`, expected/observed
rate, corruption type, timestamps, whether audio uses PTP, and scope. Also
record EOS version, platform/SKU, ASIC family, VRF, and multicast model. Call
`eos_list_inventory` if targets are unclear. Collect on affected and
comparison devices:

Establish IPv4 versus IPv6 and L2 snooping versus L3 routed multicast first.
For hardware evidence, capture forwarding/UFT profile, effective mroute/IPMC
limits, resource/counter-engine availability, fastdrop state, and counter age.

```text
show interfaces counters discards
show hardware counter drops
show policy-map copp
show multicast fib ipv4 <group> <source>
show multicast fib ipv4 summary
show ip mroute <group> <source>
show ip mroute count
show ip igmp snooping groups detail
show ip pim neighbor
show ip pim interface <interface> detail
```

Use platform-specific MMU or multicast-resource commands only when the
platform, ASIC family, and EOS support are known, and correlate results to the
affected interface, VLAN/VRF, `(S,G)`, and time window. For AES67/ST 2110-30 symptoms, collect `show ptp` and
`show ptp monitor` and route broad PTP issues to the PTP skill.

Treat hardware inspection views as independent evidence. On some EOS releases
or platforms, a hardware-resource command may clear hit bits or affect route
aging, while a software-derived MFIB view may be stale; verify command behavior
before using it during an incident and never treat one view as authoritative.
Treat route counters as unusable for causal conclusions when the route is in
fastdrop, has transitioned through fastdrop, or the platform/profile does not
support counters for that route. Counter age alone cannot prove validity;
record support, route state, and polling/transition history.

## Analysis

- Rising ingress/egress discards or hardware drops localize loss to a link or
  ASIC; compare counters over time and across hops.
- CoPP drops indicate control-plane pressure and do not prove data-plane loss.
- Multiple active `(S,G)` entries for one group are not inherently corruption;
  compare source-specific RPF, OIF, and traffic evidence before diagnosing
  multiple-source delivery.
- Groups sharing the low 23 multicast MAC bits can alias by design; correlate
  the IP group, VLAN, snooping pruning, and actual OIF membership before
  claiming aliasing.
- `Cpu` alongside hardware OIFs may indicate duplicate L2/L3 delivery; verify
  with MFIB and platform evidence.
- Wrong IIF/RPF, fastdrops, or MFIB/mroute disagreement indicates routing or
  hardware-programming trouble; route to `check-pim-health` as appropriate.

Report corruption type, affected `(S,G)`, hop/interface, drops, CoPP/MMU
evidence, duplicate sources or aliasing, RPF/MFIB state, PTP status when
applicable, severity, and the safest next diagnostic step. Do not claim a
root cause when the evidence only shows correlation.
