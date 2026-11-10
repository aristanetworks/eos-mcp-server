---
name: multicast-flow-missing
description: Diagnose an EOS multicast flow that is absent or not reaching a receiver by correlating IGMP, PIM, mroute, MFIB, RPF, and upstream state. Read-only.
trigger: |
  TRIGGER when a multicast flow does not turn up, a receiver gets no traffic, or delivery is missing on some receivers.
  SKIP for general IGMP/PIM health, intermittent drops, corruption, bandwidth anomalies, configuration changes, or MCS/SDN-managed flows.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Diagnose a missing multicast flow

Trace evidence from receiver membership through PIM state and hardware
forwarding. Distinguish “no flow was requested” from “requested but not
forwarding.”

## Safety boundaries

- Read-only EOS MCP tools only; never modify IGMP, PIM, RP, MFIB, or config.
- Never run `clear ip mroute *`, restart agents, or run traces.
- Bash, `curl`, and `tcpdump` are out of scope unless the user explicitly
  authorizes a specific read-only endpoint/command. Do not expose credentials.
- Use inventory groups/hosts and group targets where appropriate, not raw IPs.

## Inputs and baseline

Ask for receiver switch/interface, source `(S,G)`, VLAN/VRF, source switch,
expected path, and whether the deployment is EVPN/VXLAN or MCS-managed. Also
record EOS version, platform/SKU, ASIC family, and multicast model. Call
`eos_list_inventory` if targets are unclear.

Establish IPv4 versus IPv6 and L2 snooping versus L3 routed multicast before
interpreting output. When hardware state is part of the diagnosis, use
[check-multicast-forwarding-resources](../check-multicast-forwarding-resources/SKILL.md)
for configured versus effective profile evidence, IPMC/replication resources,
complete OIF comparison, and counter validity. Retain unavailable limits.

On the receiver, collect applicable IPv4 views in text mode. Substitute square-
bracket placeholders from runtime scope and select the source row locally from
the group-scoped MRIB response. These examples use the default VRF; verify
non-default VRF selectors independently before comparing views:

```text
show ip igmp membership
show ip igmp snooping groups
show ip igmp snooping mrouter detail
show ip mroute [group]
show ip mroute count
show multicast fib ipv4 [group] [source]
show multicast fib ipv4 summary
```

Use `router multicast`, `ip multicast`, and receiver VLAN/interface running
config only when configuration evidence is needed.

## Decision path

1. No IGMP membership or snooping group: verify the receiver joined, IGMP
   version, querier, mrouter port, VLAN, and report counters.
2. Membership exists but no `(*,G)` or `(S,G)`: inspect PIM neighbors and
   `show ip pim config-sanity`. Check RP only for ASM or bidirectional PIM;
   SSM-only underlays do not require an RP. Then inspect the upstream path.
3. Mroute has the wrong IIF/RPF: compare `show ip route [source]` with the
   mroute IIF and inspect PIM/RPF state.
4. Mroute has an empty OIF: correlate membership, IGMP leave state, and
   PIM joins/prunes.
5. Mroute has expected OIFs but MFIB is absent, has fewer/different outputs,
   or the selected route is in fastdrop: compare complete expected/MRIB/MFIB
   IIF/OIF sets in the same VRF and tuple. Normalize Port-Channel/member,
   SVI/tunnel and DR/pruning differences, then recheck possible convergence.
   Use [check-multicast-forwarding-resources](../check-multicast-forwarding-resources/SKILL.md)
   for the resource and programming investigation. Route presence or a reported
   `programmed=true` does not resolve a partial OIF mismatch. A stable mismatch
   does not by itself prove an ASIC defect, resource causality, or receiver loss.
6. Only some receivers fail: compare working and failing receivers and walk
   the shared upstream path.

For EVPN/VXLAN, route SMET/IMET/S-PMSI, EVPN proxy, VTEP, or OISM/SBD issues to
`check-evpn-multicast-health`. For MCS flows, use the MCS skills.

Report `(S,G)`, membership, mroute flags/IIF/OIF, RPF route, MFIB state,
upstream evidence, complete OIF differences, the missing link in the chain, and
safe next steps. State node resource alarms separately from flow-attributable
anomalies. Consistent software state leaves delivery unproven without receiver
evidence.
