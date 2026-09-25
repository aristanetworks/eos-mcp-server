---
author: Sakti Arunachalam
name: mcs-mounts
description: Diagnose MCS CVX connection and mount-state problems, including cluster asymmetry, Purple dual-homing, stuck mounts, and error 199. Read-only.
trigger: |
  TRIGGER for MCS mounts, mountStateMountComplete, CVX connection state, disconnected or connecting switches, partial Purple mounts, or error 199.
  SKIP for configuration validation (use mcs-config-validate), agent failures (use mcs-agents), or flow-specific diagnosis.
allowed-tools:
  - Bash
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
---

# Diagnose MCS Mounts

A switch is blocked until required mounts report `mountStateMountComplete`.
MCS cannot add, delete, or modify flows while the `Mcs` mount is incomplete.

## Safety and target resolution

- Never restart MCS/CVX agents to recover a mount; it can interrupt every flow.
- Do not run `trace` without explicit MCS development direction.
- Ask for CVX topology, all cluster nodes, affected switches, recent changes,
  and EOS versions. Keep credentials out of chat.
- If targets are unclear, call `mcp__eos__eos_list_inventory`.

## CVX visibility and server state

```bash
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/apiStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/agentStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/network-devices | python3 -m json.tool
```

On every CVX cluster node, run:

```text
mcp__eos__eos_run_show(target="<cvx-node>", commands=["show cvx", "show cvx connections", "show cvx service", "show cvx mounts <switch>", "show agent Mcs uptime", "show agent McsHttpAgent uptime", "show agent Controllerdb uptime"])
```

Check cluster peers first: `Registration complete` and `Version ok` are
prerequisites. Then compare nodes and classify connections:

| Output | Meaning |
|---|---|
| `established`/`active` | Healthy |
| `connecting` | Reachability or wrong endpoint/configuration |
| `disconnected` | Lost CVX connectivity |
| absent | Missing configuration or failed registration |

Both `Mcs` and `NetworkTopology` must be `mountStateMountComplete`.
`mountStateMountInProgress` for more than five minutes is stuck: existing
flows may continue, but flow changes can fail with error 199.

Use both forms of the server command:

```text
mcp__eos__eos_run_show(target="<cvx-node>", command="show cvx mounts")
mcp__eos__eos_run_show(target="<cvx-node>", command="show cvx mounts <switch>")
```

The first is the bulk all-client check; the second is the detailed per-switch
check. For each path, record the service/group, CVX node identity, peer or
client identity, mount state, heartbeat, and last update/timestamp when shown.

Interpret mount states carefully:

| State | Interpretation |
|---|---|
| `mountStateMountComplete` | Required healthy state for active MCS and NetworkTopology paths |
| `mountStateMountInProgress` | Transitional; investigate if it persists beyond the recovery window |
| `mountStateMountFailed` | Mount failure; collect logs, agent state, and configuration |
| `mountStatePreservedUnmounted` | May be expected for a legacy V2/preserved path; confirm the active required path is complete |
| `mountStateUnmountInProgress` | Transitional during removal/failover; correlate with the event timeline |

Also look for HA redundancy/state-backup mount groups. A healthy `Mcs` mount
does not prove that state replication or failover mounts are healthy.

## Client state and timeline

```text
mcp__eos__eos_run_show(target="<switch>", commands=["show management cvx", "show management cvx service", "show management cvx mounts", "show agent McsClient uptime", "show agent ControllerClient uptime", "show agent TwinCvxClient uptime"])
mcp__eos__eos_run_show(target="<switch>", command="show log last 300", output_format="text")
mcp__eos__eos_run_show(target="<cvx-node>", command="show log last 300", output_format="text")
```

Correlate `connect`, `disconnect`, `mount`, `failover`, `restart`, and
interface events. A recent failover or agent restart can explain a short
recovery window; do not restart anything to accelerate recovery.

On Purple switches, verify that `show management cvx mounts` identifies two
distinct mount paths with the expected primary and secondary CVX/fabric
identities. A single complete path is partial HA, not healthy redundancy.
Compare heartbeat and timestamp evidence on both sides; stale timestamps or a
healthy connection with no corresponding mount update indicates a control-plane
or state-sync problem.

## Decision table

| Finding | Next action |
|---|---|
| Switch absent from API/connections | Use `mcs-config-validate` |
| `connecting` on both sides | Check routing, MTU, firewall, and CVX hosts |
| `Mcs: Disabled` | Use `mcs-config-validate` |
| Agent uptime <10 minutes | Wait and re-check mount recovery |
| Incomplete mount >5 minutes with stable agents | Collect evidence and escalate |
| Complete on master, incomplete on standby | Check standby agents and cluster consistency |
| Purple has one complete path | Validate secondary CVX configuration |
| `mountStateMountFailed` | Collect logs, agent state, and config; escalate if persistent |
| `mountStatePreservedUnmounted` on a legacy path | Verify it is not the active required MCS/HA path |
| `mountStateUnmountInProgress` | Correlate with failover/removal before declaring failure |
| CVX complete but client MFIB is empty | Run post-recovery MFIB and MCS snooping checks |

## Post-recovery forwarding validation

After mounts return to complete, verify that programming actually recovered on
the affected client:

```text
mcp__eos__eos_run_show(target="<switch>", commands=["show multicast fib ipv4 mcs", "show ip igmp snooping groups mcs"])
```

Confirm expected MCS MFIB entries and snooping state are present and stable.
If error 199 remains after mount recovery, do not claim it auto-cleared: the
broadcast controller may need to re-issue `addReceiver`/flow programming.

## Output and escalation

Report API visibility, cluster role/peer state, connections, both mount groups,
agent context, timeline, severity, and next action. Escalate to `@mcs-dev` for
stable stuck mounts, inconsistent cluster state, persistent one-sided Purple
mounts, absent agents, or mounts that do not recover after failover.
Include outputs from every CVX node, client mount output, versions, uptimes,
logs, and the event timeline.
