---
author: Sakti Arunachalam
name: ptp-debug
description: Diagnose EOS PTP connectivity and message failures including missing delay responses, wrong domain, zero source IP, and unusual packet addressing. Read-only.
trigger: |
  TRIGGER for missing PTP delay responses, PTP source IP 0.0.0.0, domain mismatch, missing synchronization, or packets with zero MAC/IP addressing.
  SKIP for GM election problems; use ptp-gm instead.
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Diagnose PTP connectivity and messages

Determine whether PTP messages are generated, received, accepted, and used
for delay measurement. Distinguish a switch-side issue from a host or
third-party packet-format issue.

## Safety boundaries

- Use only read-only EOS MCP tools.
- Never change `ptp source ip`, `ptp domain`, interface PTP enablement, mode,
  or transport without explicit approval.
- Never disable PTP on a live interface, run traces, or use Bash/curl/packet
  capture without authorization for the exact read-only action.
- Configuration snippets in this skill are diagnosis context only; do not
  execute them.

## Inputs and evidence

Ask for symptom, switch/interface, PTP mode, multicast/unicast transport,
expected GM, and packet-capture availability. Also record EOS version,
platform/SKU, PTP profile, and IPv4/IPv6/Layer-2 versus unicast transport. If
the target is unclear, call `eos_list_inventory`.

For missing delay responses, collect:

```text
show ptp source ip
show ptp interface <interface>
show ptp interface <interface> counters
show ptp interface <interface> counters drop
show ptp monitor
show ptp local-clock
```

If unicast transport is used, also collect:

```text
show ptp unicast-negotiation requested
show ptp unicast-negotiation granted
```

Interpret counters in direction and role: delay requests received with no delay
responses sent points to master-side response behavior; zero requests means
the slave may be using another master or PTP is not enabled. Zero Delay_Req or
Delay_Resp counters can be normal for a master, passive port, gPTP, or inactive
interface. Check port state and transport before claiming a source-IP root
cause.

For domain mismatch, compare `Clock Domain` in `show ptp local-clock` with
the expected domain and verify the `ptp` and affected interface running config.
Zero counters can indicate silent domain filtering, but do not claim this
without matching domain evidence.

Account for supported domain translation or per-interface allowed-domain
behavior before calling the domains mismatched.

Domain handling can also be global, per-interface, or per-PTP-VLAN. Compare the
effective domain for the affected VLAN and direction, not only the global
configuration. `ptp source ip` does not apply to L2 PTP, and IPv6 transport
requires IPv6-specific interpretation rather than treating `0.0.0.0` as a
generic unknown source.

Treat PTP-agent counters as causally valid only when their epoch is known and
no restart, reboot, SSO, or hitless upgrade reset them. Hardware-forwarded
unicast PTP can bypass those counters. Hard-gate drop interpretation by the
supported PTP mode and platform; Boundary Clock management-message handling is
not the same as Transparent Clock forwarding.

For MAC/IP destination `00:00:00:00:00:00` / `0.0.0.0`, check interface
counters, ACL/CoPP evidence, forwarding versus drops, and CPU punts. Treat it
as potentially third-party behavior rather than automatically an EOS defect.

For large or unstable offsets, inspect `show ptp monitor`; this is historical
and may be disabled, empty, or cleared. For a roughly
37-second jump, inspect `show ptp local-clock time-properties` and UTC offset
validity before escalating.

## Report

Report source IP, domain, interface state, message counters, negotiation,
drop reasons, offset/mean path delay/skew, packet-addressing observations,
facts versus hypotheses, and the next safe action. Escalate when messages flow
but delay responses or timestamp accuracy remain incorrect.
