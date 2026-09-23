---
author: Sakti Arunachalam
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
interpreting output. Capture forwarding/UFT profile, effective mroute/IPMC
limits, hardware-resource availability, and counter age when hardware state is
part of the diagnosis.

On the receiver, collect:

```text
show ip igmp membership
show ip igmp snooping groups
show ip igmp snooping mrouter detail
show ip mroute <group> <source>
show ip mroute count
show multicast fib ipv4 <group> <source>
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
3. Mroute has the wrong IIF/RPF: compare `show ip route <source>` with the
   mroute IIF and inspect PIM/RPF state.
4. Mroute has an empty OIF: correlate membership, IGMP leave state, and
   PIM joins/prunes.
5. Mroute has OIF but MFIB is absent or fastdrops are present: use the
   platform/EOS-supported MFIB view (`show ip mfib` or a supported
   `show multicast fib ipv4` form), correlate route counters and resources,
   then escalate as a forwarding issue.
6. Only some receivers fail: compare working and failing receivers and walk
   the shared upstream path.

For EVPN/VXLAN, route SMET/IMET/S-PMSI, EVPN proxy, VTEP, or OISM/SBD issues to
`check-evpn-multicast-health`. For MCS flows, use the MCS skills.

Report `(S,G)`, membership, mroute flags/IIF/OIF, RPF route, MFIB state,
upstream evidence, the missing link in the chain, and safe next steps.
