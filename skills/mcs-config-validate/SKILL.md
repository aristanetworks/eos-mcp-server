---
author: Sakti Arunachalam
name: mcs-config-validate
description: Validate Arista MCS configuration across CVX servers and EOS client switches, including clusters, Purple dual-homing, and known version risks. Read-only.
trigger: |
  TRIGGER for MCS/CVX configuration validation, missing Red/Blue CVX entries, Purple switch setup, MCS client configuration, or CVX cluster configuration.
  SKIP for stuck mounts (use mcs-mounts), agent failures (use mcs-agents), or configuration changes.
allowed-tools:
  - Bash
  - mcp__eos__eos_list_inventory
  - mcp__eos__eos_run_show
  - mcp__eos__eos_get_running_config
---

# Validate MCS Configuration

Read-only validation of Arista Media Control Service on CVX servers and EOS
client switches. Use `curl` for CVX MCS APIs and EOS MCP tools for device state.

## Safety and target resolution

- Never restart `Mcs`, `McsHttpAgent`, `ControllerDb`, `Sysdb`, `McsClient`,
  `ControllerClient`, or `TwinCvxClient`; escalate instead.
- Do not run `trace` commands unless MCS development explicitly directs it.
- Ask for CVX topology, all cluster nodes, affected devices, Purple status, and
  EOS versions. Keep credentials out of chat.
- If targets are unclear, call `mcp__eos__eos_list_inventory` and use inventory
  host/group names rather than raw IPs.

## CVX API check

```bash
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/apiStatus
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/agentStatus
```

If a device is not in inventory, ask the engineer to run the equivalent EOS
commands and paste the output. Direct eAPI fallback is allowed only with an
approved endpoint and credential source.

## CVX server and cluster

On every CVX node, run:

```text
mcp__eos__eos_get_running_config(target="<cvx-node>", section="cvx")
mcp__eos__eos_get_running_config(target="<cvx-node>", section="interface Management0")
mcp__eos__eos_run_show(target="<cvx-node>", commands=["show cvx", "show cvx connections", "show cvx service"])
```

Verify:

- `cvx` and `service mcs` are present and not shut down.
- Cluster peers report `Registration complete` and `Version ok`.
- Expected clients are `established`/`active` and have `Mcs: Enabled`.
- Cluster Management0 VIP IP and MAC are identical across nodes.
- Redis password configuration is present for MCS notifications.

## Client switches

```text
mcp__eos__eos_get_running_config(target="<switch>", section="management cvx")
mcp__eos__eos_get_running_config(target="<switch>", section="mcs client")
mcp__eos__eos_run_show(target="<switch>", commands=["show management cvx", "show management cvx service"])
```

Verify `management cvx` has `no shutdown` and every primary CVX node, while
the separate top-level `mcs client` section has `no shutdown`. Both `Mcs` and
`NetworkTopology` must be enabled. Purple switches additionally require
`cvx secondary <name>` under `mcs client`, with every secondary cluster node
listed and connected.

Also inspect the client transport fields when present: source interface,
transport VRF, heartbeat interval/timeout, cluster name, security state, and
client identity. A non-default VRF must have a usable route to every configured
CVX node. Do not assume a single connected CVX node is sufficient for a
clustered deployment.

## Platform, security, and service prerequisites

On CVX and affected clients, collect the following read-only evidence as
supported by the EOS release:

```text
mcp__eos__eos_run_show(target="<device>", commands=["show version", "show platform", "show license", "show system environment all", "show management api http-commands", "show aaa authorization"])
mcp__eos__eos_get_running_config(target="<device>", section="management api http-commands")
mcp__eos__eos_get_running_config(target="<device>", section="aaa")
```

Check that the platform has adequate VM/system resources, the required EOS
support and license state, the management API is enabled on the intended
protocol/port, HTTPS/SSL policy is compatible with the client, and AAA
authentication and command authorization permit the MCS API and management
operations. Record unsupported commands as unavailable rather than treating
them as failures.

For the CVX service, verify the `cvx` configuration contains the MCS service,
Redis password/listener settings, and any required API/SSL profile. An API
health response alone does not prove Redis notifications or authorization are
healthy; correlate service state, API status, and logs.

## Topology and multicast prerequisites

On client switches, collect topology and forwarding evidence:

```text
mcp__eos__eos_run_show(target="<switch>", commands=["show lldp neighbors detail", "show lldp neighbors", "show interfaces status", "show ip interface brief", "show ip route vrf all", "show ip igmp snooping", "show ip igmp snooping groups mcs", "show multicast fib ipv4 mcs", "show ntp status", "show ntp associations", "show policy-map copp"])
mcp__eos__eos_get_running_config(target="<switch>", section="router multicast")
mcp__eos__eos_get_running_config(target="<switch>", section="ip multicast")
```

Check that LLDP and physical topology agree with the intended fabric, client
interfaces have the expected IP/VRF and routed-port/SVI mode, IPv4 multicast
routing and any required `multicast ipv4 static` settings are present, and
NTP is synchronized. Review IGMP snooping and MCS-specific snooping state,
QoS/class-map/policer behavior, ACLs, and control-plane drops for evidence that
MCS control or multicast forwarding is being filtered. Do not require PIM or
IGMP for MCS itself; check them only when the deployment uses those features.

## Conditional topology features

When the deployment uses them, explicitly validate:

- Non-default VRFs and management/data-plane route reachability.
- Multi-zone IGMP/MCS boundaries and IIF-aware host-proxy behavior.
- Multi-hop tier declarations and LLDP-discovered tier continuity.
- Path diversity and redundant paths for the intended source/receiver route.
- Reservation percentage, consistent hashing, and load-balancing settings.
- Maintenance mode/state and whether it intentionally suppresses programming.

Use running-config sections and read-only show commands for these checks. Do
not infer that a missing optional feature is broken without confirming that the
topology actually requires it.

## Topology and version checks

```bash
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/network-devices | python3 -m json.tool
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/endpoint-devices | python3 -m json.tool
curl -s [-k] [-u user:pass] http[s]://<cvx-ip>/mcs/network-links | python3 -m json.tool
```

Confirm expected switches and links are present. Flag these known risks:

| EOS version | Risk |
|---|---|
| 4.34.2F, 4.34.3M, 4.34.3.1M, 4.35.0F | Redis connectivity failures |
| 4.34.x, 4.35.x | Hardware programming bug/1148315; MCID 32767 |
| 4.33.4M | PTP issue; fixed in later releases |

Mixed EOS versions are supported. Do not mark a version mismatch as a failure
by itself; flag only the known MCS-specific exposure ranges above and report
the exact versions for patch/upgrade review.

## Output and escalation

Report API status, cluster peer state, per-switch configuration/connection
state, missing topology, version risks, and findings labeled **CRITICAL**,
**WARNING**, or **INFO**. Recommend `mcs-mounts` for mount issues and
`mcs-agents` for restart/crash symptoms. Escalate to `@mcs-dev` when config is
correct but connectivity remains broken or a known bug needs patch coordination.
