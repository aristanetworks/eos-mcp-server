---
author: Sakti Arunachalam
name: multicast-flow-drops
description: Diagnose intermittent EOS multicast loss caused by IGMP churn, PIM reconvergence, fastdrops, RPF changes, or forwarding transitions. Read-only.
trigger: |
  TRIGGER for multicast freezes, intermittent loss, drops after IGMP leave, rapid join/leave behavior, or flow state cycling.
  SKIP for a flow that never turns up, packet corruption, bandwidth anomalies, pure IGMP/PIM health, configuration changes, or MCS/SDN-managed flows.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Diagnose intermittent multicast drops

Correlate the drop timeline with IGMP leave/query behavior, PIM state,
mroute/MFIB transitions, interface counters, and event logs. A flow currently
present is not proof that it was stable.

## Safety boundaries

- Use only read-only EOS MCP tools. Never change IGMP timers, static groups,
  PIM, RP, snooping, ACL, CoPP, or hardware state.
- Never clear mroute state, restart agents, run traces, or apply a mitigation.
- Bash/tcpdump/curl require separate explicit authorization for a named,
  read-only action; do not expose credentials or packet payloads.
- Treat parameter changes and static-group configuration as proposals only.

## Evidence

Ask for receiver/interface, `(S,G)`, timestamps, symptom duration, and scope.
Also record EOS version, platform/SKU, ASIC family, VRF, and multicast model.
Use `eos_list_inventory` when targets are unclear. Collect:

Establish IPv4 versus IPv6 and L2 snooping versus L3 routed multicast first.
For hardware counters, record forwarding/UFT profile, effective mroute/IPMC
limits, resource/counter-engine availability, fastdrop state, and polling age.

```text
show ip igmp snooping counters
show ip igmp snooping groups detail
show igmp snooping querier
show ip mroute <group> <source>
show multicast fib ipv4 <group> <source>
show multicast fib ipv4 summary
show ip pim neighbor
show ip pim upstream joins
show event-monitor igmp
show interfaces counters discards
show hardware counter drops
show policy-map copp
```

Use `show ip pim sparse-mode statistics`, `show ip mfib ... counters`, and
platform-specific replication-drop commands only when the platform and
symptom justify them and the command is supported by the EOS release. Use MCP
logging for timeline or restart correlation. Event-monitor data may be read if
already available; do not enable monitoring or tracing automatically.

## Analysis

- High Reports and Leaves on one port indicate receiver IGMP churn; correlate
  with event timestamps and group-specific query behavior.
- A missing querier or inactive pruning can cause flooding; route broad
  snooping issues to `check-igmp-health`.
- PIM neighbor expiry, join/prune cycling, or changing RPF/IIF indicates a
  control-plane or routing event; route to `check-pim-health` as appropriate.
- MFIB fastdrops, interface/hardware drops, or replication drops indicate a
  forwarding/resource issue only when correlated to the affected interface,
  VLAN/VRF, `(S,G)`, and time window.
- CoPP drops primarily indicate loss of IGMP/PIM/PTP control packets; they do
  not automatically prove that already-programmed multicast data is dropping.
- Some hardware/resource views are platform and release dependent; verify that
  the inspection command is observational and does not clear hit bits or alter
  route aging before using it during an incident.
- Treat route counters as unusable for causal conclusions when the route is in
  fastdrop, has transitioned through fastdrop, or the platform/profile does
  not support counters for that route. Counter age alone cannot prove that a
  value is valid; record support, route state, and polling/transition history.
- Compare a working interval or receiver with the failing interval; do not
  infer causality from one counter snapshot.

Report the time window, affected `(S,G)` and interface, counters/events,
PIM/mroute/MFIB state, correlation strength, severity, and safe next evidence.
