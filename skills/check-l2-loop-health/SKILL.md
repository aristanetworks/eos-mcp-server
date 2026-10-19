---
author: Matthieu Tâche (AI Agent)
name: check-l2-loop-health
description: Diagnose suspected Layer 2 loops or verify bridge isolation on Arista EOS using read-only topology, VLAN translation, Port-Channel, STP, MAC and counter evidence. Distinguishes historical events, suspicious symptoms and demonstrated loops.
trigger: |
  TRIGGER when the user suspects an L2 loop, asks to verify bridge isolation, or asks whether MAC churn, a broadcast storm or unexpected copies indicate a loop. Include VLAN translation, QinQ and parallel EVPN/VXLAN paths when they are part of that question.
  SKIP for routine nominal unicast or multicast qualification without a loop or isolation concern, configuration changes, containment actions, general VLAN/Port-Channel health, or non-Arista platforms.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_get_facts
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check Layer 2 loop health

Investigate the affected bridge paths using EOS MCP reads. Never change
configuration, shut interfaces, clear counters or learned state, enable event
monitoring, or start/stop traffic or captures. Analyze existing captures and
receiver statistics only when supplied or accessible through authorized reads.
Containment is a separate workflow.

## Scope and collection

Use the named inventory hosts or groups; raw IP targets are not accepted.
If the target is unclear, call `eos_list_inventory` and resolve it with the user.
Prefer a group call for devices needing the same commands. Include adjacent
attachments needed to establish the path; identify inaccessible parts explicitly.

Record the symptom, expected forwarding path, affected interfaces, wire tags,
local bridge VLANs, VNIs/VTEPs, traffic direction and observation window.
Use `eos_get_facts` for each device's EOS version, model and uptime. Do not infer
ASIC capabilities from a generic product family or from cEOS results.

Read [the command reference](references/commands.md) before collecting evidence.
It identifies command forms, output fields and release/platform limits. Substitute
verified identifiers, use plain single-line commands without output modifiers,
and batch small related sets with `eos_run_show`, `output_format: text`.
Use JSON or auto only when that command's JSON contract has been verified for
the target release; public text examples do not establish JSON field names.
Inspect each device result and each command's actual output format. Isolate an
unsupported optional command from the batch; missing evidence is not healthy state.

Use `eos_get_running_config` with a narrow `section` for relevant interface,
VLAN, VXLAN or EVPN configuration. Its `config_text` is text, not a JSON schema
for interface state. Keep collected configuration local and redact sensitive
data from reports.

## Establish the effective bridge path

Trace both directions through each affected attachment, including external
bridges and parallel paths. Distinguish a routed link transporting VXLAN as IP
from a link bridging the service VLAN. VRF separation alone does not isolate
attachments in the same bridge VLAN.

For each attachment correlate:

- Operational link/switchport mode, allowed and forwarding VLANs, native VLAN,
  access or tunnel VLAN, and STP state.
- Translation from wire tag(s) to the local bridge VLAN, its operational status
  and effective ingress/egress directions. Configured translation alone does not
  establish forwarding or isolation; verify the platform's filtering order.
- For QinQ, outer S-VLAN, inner C-VLAN, TPID and which tags are pushed, popped or
  retained at each boundary. One outer tag can carry several logical receivers.
- Actual VLAN/VNI bindings and remote VTEPs where VXLAN is configured. Do not
  assume every translated VLAN belongs to an EVPN instance.
- Port-Channel active members and LACP state. Model a bundled aggregate as one
  logical bridge attachment, then investigate inactive or individual members.

Compare the trunk's effective membership with the intended service in the
local bridge domain. An unintended allowed VLAN may reconnect isolated paths;
do not impose a universal allowed-VLAN list on unrelated services. Verify that
access ports, trunks, external patches and overlay mappings do not reconnect
the domains elsewhere. A missing part of this graph prevents an isolation claim.

Where applicable, use [check-port-channel-health](../check-port-channel-health/SKILL.md)
for LACP/member details and [check-evpn-health](../check-evpn-health/SKILL.md)
for ESI, DF and MAC mobility. Do not assume Ethernet Segment split horizon on
independent Port-Channels, or apply L2-subinterface/VPLS split-horizon behavior
to ordinary trunks without feature-specific evidence.

## Compare timestamped observations

Take at least two observations under existing representative traffic across
the agreed window. Record collection times, elapsed time and command scope;
group queries are not simultaneous snapshots. Preserve raw outputs locally.

Correlate STP roles/state and topology changes, movements of the same MAC within
the same bridge domain, Port-Channel membership, packet/error counters and
observed traffic. Use already enabled event-monitor data and bounded logging
queries when available; do not enable either facility or clear their history.

Calculate counter deltas over the measured interval and compare them with offered
traffic and expected replication. A restart, counter reset, wrap, missing sample
or changed member set can invalidate a comparison. Repeated MAC-table snapshots
can miss movement between samples; stable endpoints alone do not prove no churn.

A quiet STP instance cannot exclude a loop across VXLAN or an external bridge
outside its BPDU domain. Old topology events, high cumulative counters, a blocked
STP port, MAC movement or duplicate-MAC suppression alone do not demonstrate an
active loop. Legitimate mobility, MLAG/EVPN learning and multiple routers sharing
a system/virtual MAC can produce similar symptoms. Compare actual SVI/source MACs,
their independent emitters and local/remote learning before attributing a loop.

For an external multicast-router attachment, correlate local bridge VLAN,
mrouter ports, proxy membership and SMET state with the intended path using
[check-evpn-multicast-health](../check-evpn-multicast-health/SKILL.md) when needed.
If wildcard SMET is observed, verify its meaning for the configured integration;
route signaling alone does not demonstrate a loop.

Receiver delivery requires per-receiver evidence. Aggregate multicast Rx can
correctly exceed Tx by the fanout, and losses and duplicates can cancel in the
aggregate. Use each receiver's expected count and flow identity. For QinQ include
physical attachment and inner C-VLAN as well as outer S-VLAN; account for any
external fanout/flooding before calling physical copies duplicate deliveries.

## Report the conclusion and its limits

Give one row per affected path/device with wire-to-local VLAN/VNI mapping,
observation interval, traffic conditions, evidence references and one conclusion:

| Conclusion | Required interpretation |
| --- | --- |
| Historical | Events predate the window, with no observed recurrence. This does not qualify current forwarding by itself. |
| Suspicious | Current churn, topology changes, unexpected replication or rate growth needs explanation; circulation is not established. |
| Demonstrated loop | An active closed forwarding path and correlated recirculation evidence establish a loop. Explain repeated packet identities or other evidence that excludes legitimate emitters, fanout and finite duplicate paths. |
| No loop observed during the window | The relevant path and isolation checks are complete, with stable dynamic evidence under stated traffic. Limit the claim to that coverage and interval. |
| Not qualified | Missing topology, inactive/unknown required translation, absent representative traffic, unsupported commands or insufficient observations prevent the requested conclusion. |

Distinguish an accidental topology cycle blocked by STP from an active forwarding
loop. Unexpected copies can also result from finite parallel replication without
recirculation. State remaining proof gaps and the next read-only evidence needed;
do not recommend a disruptive action as an automatic continuation of this skill.
