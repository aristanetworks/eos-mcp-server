---
author: Sakti Arunachalam
name: multicast-triage
description: Triage Arista EOS multicast symptoms and route the investigation to IGMP, PIM, EVPN, flow, bandwidth, or controller diagnostics. Read-only.
trigger: |
  TRIGGER for multicast not working, missing or partial delivery, flooding, corruption, drops, unexpected bandwidth, or unclear multicast symptoms.
  SKIP for configuration changes, pure IGMP health requests, pure PIM health requests, or MCS/SDN-managed multicast; use the specialized skill.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Triage multicast symptoms

Classify the failure and collect a small, high-value read-only evidence set.
Route deeper work to the existing IGMP, PIM, EVPN, or symptom-specific skills.

## Safety boundaries

- Use only the EOS MCP read-only tools listed above.
- Never change IGMP, PIM, RP, MFIB, snooping, ACL, CoPP, or multicast config.
- Never clear multicast state with `clear ip mroute *` or similar commands.
- Never restart agents, run `trace`, or use Bash, `curl`, or `tcpdump` against
  a device unless the user separately authorizes that exact read-only action
  and endpoint. Keep credentials out of output.
- Treat mitigation commands as proposals requiring explicit approval; do not
  execute them. Use inventory host/group names, not raw IP targets.

## Triage questions

Ask for receiver and source devices, group/source `(S,G)` if known, VLAN/VRF,
symptom, scope, expected versus observed behavior, and whether the flow is
MCS/SDN-managed or standard IGMP/PIM. Also record EOS version, platform/SKU,
ASIC family, VRF, and EVPN multicast model when relevant. If the target is
unclear, call `eos_list_inventory` before querying devices.

Establish address family and L2 versus L3 mode before selecting commands:
IGMP/IPv4 PIM/MFIB are not interchangeable with MLD/IPv6 multicast views.

## Initial evidence

On the receiver switch, use one `eos_run_show` call with the commands relevant
to the symptom:

```text
show ip igmp membership
show ip igmp snooping groups
show ip mroute <group> <source>
show ip pim neighbor
show ip pim rp
show multicast fib ipv4 summary
```

| Finding | Route |
| --- | --- |
| No IGMP membership or wrong receiver port | `check-igmp-health` or `multicast-flow-missing` |
| Missing PIM neighbor, RP, or RPF path | `check-pim-health` or `multicast-routing` |
| Mroute exists but MFIB/OIF is absent | `multicast-flow-missing` or `multicast-flow-drops` |
| Intermittent loss, leave/query churn, or fastdrops | `multicast-flow-drops` |
| Corruption, hardware/MMU/CoPP drops, or duplicate traffic | `multicast-flow-corrupt` |
| Double or reduced bandwidth | `multicast-bandwidth` when available |
| EVPN/VXLAN/SMET/IMET/S-PMSI symptoms | `check-evpn-multicast-health` |
| Controller-driven IGMP/PIM symptoms | `multicast-controller` when available |
| MCS/SDN API-driven multicast | `mcs-config-validate` or `mcs-mounts` |

Interpret RP evidence conditionally: RP is required for ASM or bidirectional
PIM, not for SSM-only underlays. Treat MFIB commands as platform/version
dependent (`show ip mfib` versus `show multicast fib ipv4` variants). Keep
IGMP snooping, PIM/MRIB, MFIB, and ASIC forwarding as separate evidence planes.
CoPP drops primarily explain control-plane packet loss; they do not by
themselves prove that programmed multicast data is being dropped.
For hardware investigation, also capture forwarding/UFT profile, effective
mroute/IPMC limits, hardware-resource and counter-engine availability, fastdrop
state, and counter polling age. A missing or zero counter can mean unsupported
route type, unavailable resources, stale polling, or fastdrop.

Report observed facts, hypotheses, selected route, missing evidence, and
severity. Do not call an empty MFIB or IGMP table a forwarding failure without
confirming that a flow and receiver are expected.
