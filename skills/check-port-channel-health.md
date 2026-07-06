---
author: Matthieu Tache
name: check-port-channel-health
description: Audit Port-Channel and LACP health on Arista EOS devices via the eos MCP server. Reports bundled member ports, LACP aggregate state, switchport mode, access VLAN, trunk VLANs, and dot1q-tunnel status. Read-only — does not modify any device.
trigger: |
  TRIGGER when the user asks about Port-Channel, port channel, LAG, LACP, bundled ports, channel-group, aggregate interfaces, link aggregation, MLAG member links, EVPN-MH attached port-channels, switchport mode on a Port-Channel, access VLAN on a Port-Channel, trunk VLANs on a Port-Channel, dot1q-tunnel mode, or asks whether a Port-Channel is up/bundled.

  SKIP when the request is about configuring Port-Channels (writes), non-Arista platforms, or pure physical interface error analysis without LACP/Port-Channel context (use check-interface-health instead).
allowed-tools:
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
  - mcp__eos__eos_show_logging
---

# Check Port-Channel health on EOS devices

You are auditing Port-Channel and LACP state on Arista EOS devices via the `eos` MCP server. This skill is **read-only** — never call write tools, never modify configuration.

## When to use this skill

- The user asks whether a Port-Channel/LAG is up, bundled, or carrying traffic
- The user asks about LACP member state or aggregate membership
- The user asks to verify switchport mode, access VLAN, trunk VLANs, or dot1q-tunnel mode on Port-Channel interfaces
- A connected endpoint, MLAG, or EVPN multihoming issue depends on Port-Channel state

## Resolving the target

Targets must be inventory host or group names (the eos server rejects raw IPs).

1. If the user named a target explicitly (`leaf1`, `HARNESS`, `all`), use it directly.
2. If the target is unclear or missing, first call `mcp__eos__eos_list_inventory` and ask the user which host or group they want.
3. Prefer group targets over per-host loops — the MCP server fans out concurrently and returns one consolidated response.

## Command syntax

Use EOS-native Port-Channel commands. Do **not** default to Cisco-style `show etherchannel summary`, and do **not** rely on `show port-channel summary`; the latter is not accepted on some EOS/cEOS builds. Use the explicit forms below.

For specific Port-Channel IDs, issue these in a single `mcp__eos__eos_run_show` call:

```eos
show port-channel <id>
show port-channel <id> all-ports
show interfaces port-channel <id> switchport
```

For several IDs, repeat the commands per ID in the same MCP call:

```eos
show port-channel 31
show port-channel 31 all-ports
show interfaces port-channel 31 switchport
show port-channel 51
show port-channel 51 all-ports
show interfaces port-channel 51 switchport
```

For an overview across the device, use:

```eos
show port-channel
show lacp aggregates
```

If a compact table is specifically useful, try this EOS command:

```eos
show port-channel dense
```

## Parsing `show port-channel <id>`

Extract:

- Port-Channel name and ID
- Active member ports
- Whether the active member list is empty

Healthy output has at least one expected active member:

```text
Port Channel Port-Channel51:
  Active Ports: Ethernet5/1 Ethernet6/1
```

Flag these conditions:

- No active ports listed
- Fewer active ports than expected
- Unexpected member interfaces

## Parsing `show port-channel <id> all-ports`

Use this when a Port-Channel is missing expected members. It includes inactive or unconfigured members that `show port-channel <id>` may omit.

Flag member states that indicate a problem:

- Suspended
- Individual
- Out-of-sync
- Incompatible with aggregate
- Not collecting or not distributing

## Parsing `show lacp aggregates`

Use this for device-wide LACP correlation. Extract:

- Port-Channel aggregate ID
- Member ports
- Bundled versus inactive/suspended state

This command is useful when the user asks "which LAGs are bundled" without naming a specific Port-Channel.

## Parsing `show interfaces port-channel <id> switchport`

Extract these fields:

- `Switchport`
- `Administrative Mode`
- `Operational Mode`
- `Access Mode VLAN`
- `Trunking Native Mode VLAN`
- `Trunking VLANs Enabled`
- `Dot1q ethertype/TPID`, when present

For dot1q-tunnel verification, expect:

```text
Administrative Mode: tunnel
Operational Mode: tunnel
Access Mode VLAN: <S-VLAN>
Dot1q ethertype/TPID: 0x8100 (active)
```

For access-mode verification, expect:

```text
Administrative Mode: static access
Operational Mode: static access
Access Mode VLAN: <VLAN>
```

For trunk verification, expect:

```text
Administrative Mode: trunk
Operational Mode: trunk
Trunking VLANs Enabled: <allowed-vlans>
```

## Running-config drill-down

When the user asks to prove the configured state, or when show output and intended state disagree, call `mcp__eos__eos_get_running_config` for the exact interface section:

```text
section: interface Port-Channel51
```

Check for:

- `switchport access vlan <vlan>`
- `switchport mode dot1q-tunnel`
- `switchport mode trunk`
- `switchport trunk allowed vlan <vlans>`
- unexpected `switchport vlan translation ...`

## Output format

Return a concise Markdown report:

```text
Port-Channel health — <target>

| Device | Port-Channel | Active Members | Admin Mode | Oper Mode | VLANs | Status |
|---|---:|---|---|---|---|---|
| leaf1 | Po51 | Et5/1 Et6/1 | tunnel | tunnel | access 3000 | OK |
```

Then summarize:

- N devices checked
- M Port-Channels checked
- K with missing/inactive members or switchport mismatches

## Don't

- Don't use `show etherchannel summary`; it is not EOS syntax.
- Don't default to `show port-channel summary`; use `show port-channel <id>` for named checks and `show port-channel dense` only for compact overview.
- Don't assume `Administrative Mode: tunnel` is wrong when validating `switchport mode dot1q-tunnel`; EOS displays dot1q-tunnel mode as `tunnel`.
- Don't modify configuration from this skill.
