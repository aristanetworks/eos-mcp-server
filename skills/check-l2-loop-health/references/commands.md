# Read-only command and evidence reference

Use this reference for the affected path only. The public EOS manual documents
command families; a command's presence does not establish feature support on
every EOS release, hardware SKU or virtual image. Record `eos_get_facts` model,
EOS version and uptime with observations. Confirm optional syntax and hardware
behavior in the matching release documentation before relying on it.

No device, EOS image or hardware SKU was tested for this skill. The command
research is offline; it does not certify a minimum release or a support matrix.
Never infer hardware translation or multicast support from a cEOS result.

Documentary baseline: the [public EOS User Guide, version 4.37.0F](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1),
reviewed on 2026-11-10. Page references below use PDF page indices. The URL
is rolling; this review does not establish a minimum release or tested SKU.

## MCP collection and output

- `eos_get_facts` provides `results[].facts.model`, `eos_version` and `uptime`
  when available. Its `system_mac` is not proof of the actual SVI or virtual
  router source MAC; compare those identities separately.
- `eos_run_show` accepts either `command` or `commands`, with an inventory
  `target`. Use `output_format: text` for the documented operational variants.
  Choose auto or JSON only after verifying that command's JSON contract on the target.
- Read each `results[]` entry's `inventory_hostname`, `status`, `error_code`
  and `message`. On success, inspect `command_results[]`: `command`,
  `output_format` and `output`. JSON retains the decoded payload; text is a string.
  Preserve the command's actual format rather than assuming JSON from the request.
- Auto retries the batch as text for a JSON-unavailable error. It does not repair
  invalid syntax, authorization or transport errors. Split an optional command
  that invalidates a batch; do not treat the rest as successfully collected.
- The EOS JSON payload inside `output` varies by command and release. The public
  references below describe text tables, not a portable JSON schema. No fixed
  EOS JSON field paths are asserted here. Inspect the returned keys, or collect
  text, rather than inventing paths or interpreting an absent key as zero.
- `eos_get_running_config` uses a narrow `section` such as
  `interface Port-Channel[id]` with its placeholder replaced. Group targets
  require a section. Read each successful result's `config_text` and verify
  the section's interface identity; do not send configuration through run-show.
- `eos_show_logging` accepts `minimum_severity` and `message_count` (default
  severity `warnings`, default count 100). Choose a severity that includes the
  events of interest; the default can omit lower-severity movement events.
  Keep timestamps, device identity and retention limits; history is not a delta.

Substitute every placeholder below before calling the tool. Identifiers must
come from inventory/configuration and the user's scope. Commands are single-line
reads; do not append pipes, `| json` or shell modifiers.

## Attachments and VLAN translation

Public source: [VLAN command reference, sections 13.3.4.10-15](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=2042),
the `show interfaces switchport`, VLAN mapping, `show interfaces trunk` and
`show vlan` command sections.

```eos
show interfaces [interface] switchport
show interfaces switchport vlan mapping
show interfaces [interface] trunk
show vlan id [vlan]
```

| Read | Extract and correlate | Limit |
| --- | --- | --- |
| Switchport | Administrative/operational mode, access/tunnel VLAN, native VLAN, allowed VLANs and TPID when displayed | Configured mode is not operational forwarding proof. |
| VLAN mapping | Interface, original/outer/inner tag fields, resulting bridge VLAN, status, configured direction and active direction when displayed | Output layouts and feature variants differ. A configured direction is not proof of hardware programming. |
| Trunk | Allowed VLANs, allowed/active VLANs and VLANs forwarding under STP | These sets describe different gates; an allowed VLAN alone is not forwarding evidence. |
| VLAN | VLAN ID, status and member ports | Default output can omit inactive members; absence is not proof that no configured attachment exists. Correlate running configuration. |

Map incoming wire tag(s) to the local bridge/service VLAN and map that VLAN to
the outgoing tag(s) separately. Interpret table headings in the context of the
translation/tunnel mode: a table's tag field is not a universal description of
the final on-wire QinQ stack. Distinguish preservation of an inner customer tag
from translation of an explicit tag pair. If active direction or tag handling
is unavailable, retain that proof gap rather than assuming bidirectional mapping.

Compare local bridge VLAN membership with the intended services, and verify the
matching release/SKU's ingress and egress filtering behavior. The public command
tables alone do not establish a universal ASIC filtering order.

## STP, MAC history, counters and aggregates

Public sources: [STP detail](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1924),
[STP topology status](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1937),
[MAC table](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1819), [counters](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1493),
[error counters](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1498), [LACP](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1629),
[Port-Channels](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=1642), and [Event Monitor](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=410).

```eos
show spanning-tree vlan [vlan] detail
show spanning-tree topology vlan [vlan] status detail
show mac address-table vlan [vlan]
show event-monitor mac
show interface counters
show interfaces counters errors
show port-channel
show lacp aggregates
```

| Read | Extract and correlate | Limit |
| --- | --- | --- |
| STP VLAN detail | Instance/root identity, port role/state and topology-change history | Event age/count is not a change during the observation window. Empty output may mean no active STP instance. |
| STP topology status | Topology/VLAN mapping and effective forwarding ports | `status` is part of this command form. It covers STP-managed topologies, not every external or overlay bridge path. |
| MAC table | VLAN, MAC, entry type and local interface or remote attachment | Two equal snapshots can miss intermediate moves; distinguish dynamic, static and shared router MACs. |
| Existing MAC events | Event time, VLAN, MAC, old/new attachment and VTEP when present | Monitoring must already be enabled. Local and VXLAN event rows may have different or empty fields; retention and filters vary by release. |
| Packet/error counters | Same interface, direction, packet class, error type and units at both times | Use cumulative snapshots with external timestamps. Do not depend on session-based `delta` checkpoints. Reset/wrap/restart invalidates an interval. |
| Port-Channel/LACP | Aggregate identity, active/bundled members and exceptional member states | Unequal member traffic is normal under hashing. Sum equivalent member counters once; do not add the logical aggregate a second time. |

The base Event Monitor command is optional. Confirm release-specific time/VLAN
and result-limit filters before retrieving a potentially large history. Prefer
bounded logging when history cannot be retrieved within the response limit;
record missing event coverage. Event Monitor requires privileged EXEC; if the
read tool cannot access it, mark it unavailable without an enable or shell fallback.
Do not enable monitoring or synchronize it with
a separate operational command. Preserve the displayed headers and distinguish
unavailable, empty and truncated history.

For source/SVI MAC identity, consult the public interface command reference for
the matching interface type and compare operational source addresses with the
configured virtual/router identity. A system MAC alone cannot identify every
router emitter on that device.

## EVPN and external multicast-router attachments

Use these only where the path actually uses VXLAN/EVPN or the relevant
multicast-router integration. Public sources:
[VNI mapping](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=4320), [EVPN instance](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=4314),
[IGMP proxy](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=4148), [mrouter](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=4153), and
[group-scoped SMET](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf#page=4412).

```eos
show vxlan vni
show bgp evpn instance vlan [vlan]
show ip igmp snooping groups proxy vlan [vlan] detail
show ip igmp snooping mrouter vlan [vlan] detail
show bgp evpn route-type smet multicast [group]
```

| Read | Extract and correlate | Limit |
| --- | --- | --- |
| VXLAN VNI | VNI, local VLAN association and operational state when displayed | A VLAN binding alone does not prove remote forwarding or isolation. |
| EVPN instance | VLAN/EVI identity, RD/RT and relevant VTEP/route state when displayed | Match the actual local VLAN and configured service; not every bridge VLAN has an EVPN instance. |
| IGMP proxy | VLAN, group/source, interfaces/members and filter mode when displayed | Proxy state is signaling evidence, not per-receiver packet delivery. |
| Mrouter | VLAN, local router-facing attachment and dynamic/static learning | A router-facing port is not a host receiver and is not evidence of a loop. |
| SMET | RD, multicast tuple, originating VTEP and next hop for the selected group | Correlate with the service and local mrouter state; signaling does not prove receiver delivery or recirculation. |

Select the multicast group from the affected flow before querying SMET. The
VNI command displays the mapping table: inspect the relevant entries locally
only if the table fits the response limit. For larger tables, verify a supported
release-specific filter or record the coverage gap; do not invent syntax or use
a CLI pipe. The VNI selector form is not corroborated by this public guide.

Do not equate router-facing interest with a subscription by every host. Verify
the integration's documented signaling, advertising VTEP, RD/VLAN and router-facing
path before interpreting extra copies. A wildcard tuple, where observed, is not
recirculation evidence by itself.
Check external-router integration and EVPN multihoming support independently;
availability of a show command is not proof that either feature is active.

## Public references and applicability

Public references are guidance for command selection and interpretation. Validate
the returned format and feature applicability on the exact target release before
using it as operational evidence. Unsupported syntax, unavailable history or
missing fields are explicit evidence gaps, not a pass and not proof of a loop.
