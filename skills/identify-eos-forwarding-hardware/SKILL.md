---
name: identify-eos-forwarding-hardware
description: Identify the installed forwarding ASICs, modular cards, forwarding agents and relevant interface-to-chip mappings on Arista EOS before selecting hardware diagnostic commands. Return reusable identity and scope evidence for flow, route, L2 or multicast skills. Read-only.
trigger: |
  TRIGGER when the user asks which forwarding ASIC an EOS device or interface uses, needs SKU-to-ASIC identification, investigates mixed line cards, or another skill needs hardware scope before choosing platform commands.

  SKIP configuration changes, feature enablement, packet generation, non-Arista platforms, and forwarding-health conclusions from identity alone. Feature-specific table inspection remains with the calling diagnostic skill.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_get_facts
  - mcp__eos__eos_run_show
---

# Identify EOS forwarding hardware

Identify what is installed, then return the scope a diagnostic skill needs to
select its documented hardware reads. A product family, shared ASIC generation
or forwarding-agent name alone does not establish command compatibility.
Identity discovery does not prove route/MAC programming or packet delivery.

## Establish the requested scope

Use inventory host/group names as targets. Record the relevant interfaces and
why they matter to the caller, such as ingress or candidate egress. If the
caller has not established those interfaces, identify the system but leave its
required chip coverage unknown. Do not infer a physical path from a port list.

Reuse supplied evidence or existing same-interval facts. An offline-only request
means inspect supplied artifacts without contacting devices. Otherwise use only
the read tools above for authorized targets. Keep timestamps and model/EOS
identity attached to observations; do not combine changed module/chip inventories
into one confirmed mapping.

Read the [discovery commands](references/commands.md) for exact forms, text
fields, access caveats and failure handling. Batch independent reads on eligible
groups; use a host or subgroup when interface operands or applicability differ.
No feature enablement, configuration-mode transition, SDK/shell access, counter
change or active test is part of this skill.

## Identify the installed system, cards and chips

1. Record the complete model and EOS release from supplied facts or
   `eos_get_facts`; D01 is the fallback identity read. Preserve hardware revision
   when available. A broad series name cannot replace the exact model.
2. On modular systems, use D02 to record each installed card's slot, model, role
   and status. Treat line cards, fabric modules and supervisors separately.
   A chassis model does not identify its forwarding cards. An unreadable module
   inventory leaves the affected card identities unresolved.
3. Use D03 to retain chip label, name, revision, slot and forwarding agent.
   Associate module/chip records only through an established slot mapping;
   retain ambiguous names as returned. Distinguish forwarding, fabric and
   unknown roles. A fabric row can report a forwarding agent; agent presence
   does not make it a front-panel forwarding chip.
4. Where applicable, use D04 to corroborate FAP identity. Preserve exact reported
   chip names rather than guessing ASIC aliases from model suffixes or agent
   names. If observations conflict with a static table, report the conflict and
   retain both sources; do not silently substitute the table's chipset.

Compare the result with the [platform profiles](references/platform-profiles.md)
when selecting an in-scope family/card. These profiles constrain interpretation;
they are not a release/SKU command-support matrix. Missing table entries mean
unknown mapping from that source, not unsupported hardware. Do not infer support
for another product merely because it shares an ASIC.

## Map only the relevant interfaces

Use existing verified port-to-chip evidence or the conditional D05 example.
Record ingress and candidate egress mappings independently, including slot,
chip/FAP identity, core and port fields actually returned. A chip inventory is
not a port map. A chip name, FAP name and lookup index need not share one
namespace; establish their association before a caller reuses them.

The public mapping example does not qualify every model, modular/breakout
selector or EOS release. If the exact interface selector or chip association is
unverified, return an unknown mapping and the missing evidence. Do not guess a
selector or use the first chip in the output as a default. Preserve partial
coverage when some relevant interfaces map and others do not.

## Hand evidence to the calling skill

Return a compact record with these fields; this is an assistant evidence
contract, not a promised EOS JSON schema:

| Field | Required content |
| --- | --- |
| Device/context | Inventory target, complete model, EOS release, collection interval |
| Modules | Slot, exact card model, role and status; modular applicability |
| Chips | Slot, chip label/name/revision, forwarding agent and role |
| Relevant ports | Interface and caller-supplied role; mapped slot/chip/FAP/core/port fields, or the unresolved mapping |
| Profile | Matching family/card restriction, public source/release, mismatches or unqualified scope |
| Provenance | Command or supplied artifact, time, actual format; distinguish observed identity from reference-inferred mapping |
| Limitations | Unsupported/denied/failed reads, conflicting identity, unknown fields and uncovered relevant chips/interfaces |

Use **observed**, **reference-inferred**, **conflicting**, **unknown**,
**unsupported**, **unavailable** or **not applicable** with a reason for the
relevant field/read. Missing fields are not zero. One successful identity read
does not erase another failure or qualify all cards. If only table-derived
identity is available, label it reference-inferred; do not report it as an
observed ASIC inventory.

The caller uses this record to select its own exact command forms against
public documentation for the identified model, card, chip and EOS release.
Keep VRF mapping, route/FEC index scope and feature prerequisites with that
feature's procedure. Runtime parser acceptance, documented applicability,
software/agent shadow state, hardware-reported state and fresh ASIC readback
remain separate claims. If scope or read semantics cannot be established,
return that gap instead of certifying hardware-command support.

Reuse this record in other diagnostics only while model, release, installed
cards/chips and relevant interface mappings remain unchanged. Preserve source
times; a cached identity does not prove current hardware state.
