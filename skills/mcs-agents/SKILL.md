---
author: Sakti Arunachalam
name: mcs-agents
description: Diagnose MCS agent uptime, restart, crash-loop, and API availability problems on CVX servers and EOS client switches. Read-only; never restarts agents.
trigger: |
  TRIGGER for MCS agent health, uptime, crashes, restart counts, crash loops, API availability, or Mcs/McsHttpAgent/Controllerdb/McsClient/ControllerClient/TwinCvxClient questions.
  SKIP for configuration state (use mcs-config-validate), mount state (use mcs-mounts), or a specific multicast flow.
allowed-tools:
  - Bash
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_show_logging
---

# Diagnose MCS Agents

Read-only diagnosis of MCS agent health. Recent restarts can cause mount
renegotiation and flow interruption; crash loops require escalation.

## Non-negotiable safety rules

Never restart `Mcs`, `McsHttpAgent`, `ControllerDb`, `Sysdb`, `McsClient`,
`ControllerClient`, or `TwinCvxClient`. Do not run `trace` commands unless MCS
development explicitly directs it, and disable traces after collection.

## Target and initial API check

Ask whether the issue is on CVX, a CVX cluster, a client switch, or both. For
clusters include every node. If targets are unclear, call
`mcp__eos__eos_list_inventory`. Then run:

```bash
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/apiStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/agentStatus
```

An unresponsive API suggests `McsHttpAgent`, but confirm agent state.

## CVX agents

On every CVX node:

```text
mcp__eos__eos_run_show(target="<cvx-node>", commands=["show agent Mcs uptime", "show agent McsHttpAgent uptime", "show agent Controllerdb uptime"])
mcp__eos__eos_run_show(target="<cvx-node>", command="show log last 200", output_format="text")
```

Scan logs for `restart`, `crash`, `core`, `segfault`, `exception`, `killed`,
`OOM`, and `out of memory`. Classify:

| State | Meaning |
|---|---|
| Days/weeks uptime, stable count | Healthy |
| Uptime <1 hour or small restart count | Warning; recent restart possible |
| Missing/not running or count increasing | Critical; escalate |

On clusters compare master and standby. An unhealthy standby threatens
failover safety even when the master is healthy.

## Client agents

```text
mcp__eos__eos_run_show(target="<switch>", commands=["show agent McsClient uptime", "show agent ControllerClient uptime", "show agent TwinCvxClient uptime"])
mcp__eos__eos_run_show(target="<switch>", command="show log last 200", output_format="text")
```

`TwinCvxClient` is critical on Purple switches and may be absent on non-Purple
switches. Missing `McsClient` means routes cannot be installed; missing
`ControllerClient` prevents CVX communication.

## Recovery verification

After a recent restart, verify API and state without making changes:

```bash
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/apiStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/agentStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/senders | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("senders", [])))'
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/receivers | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("receivers", []); print(len(r), sum(x.get("action") == "impacted" for x in r))'
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/failed-flows | python3 -m json.tool
```

Use `mcs-mounts` to check renegotiation. A new master may have low uptime
briefly after failover; if mounts remain incomplete after roughly ten minutes,
escalate rather than restarting agents.

## Interpretation and escalation

- Stable agents: use `mcs-mounts` or flow diagnostics.
- Recent `Mcs`/`Controllerdb` restart: inspect mounts and allow recovery time.
- `McsHttpAgent` restart/down: verify API and sender/receiver state.
- Client `McsClient` restart: verify MFIB and mounts.
- Crash loop, absent required agent, unhealthy standby, both cluster nodes
  unhealthy, MCID 32767, or Redis failures on 4.34.2F–4.35.0F: escalate to
  `@mcs-dev` immediately.

## Output format

Report each agent’s role, uptime, restart context, API impact, log timestamps,
cluster comparison, severity, and explicit confirmation that no agent restart
was performed. Include all relevant node outputs, EOS versions, mount state,
and the incident timeline when escalating.
