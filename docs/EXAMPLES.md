# EOS MCP Server — Example Prompts

These examples show how to interact with the EOS MCP server through Claude. All examples are drawn from a real cEOSLab testlab session.

This assumes `eos-mcp-server` is already installed and you have an inventory file — see [Install and get started](../README.md#install-and-get-started) or the [Quickstart](QUICKSTART.md) if not.

---

## Setup

### Add the MCP server from `.mcp.json`

As an alternative to `claude mcp add` (see the README's [Connect to an MCP client](../README.md#connect-to-an-mcp-client)), place a `.mcp.json` file in your project directory — Claude Code auto-discovers it without any import command:

```json
{
  "mcpServers": {
    "eos": {
      "command": "eos-mcp-server",
      "args": [
        "serve",
        "--inventory",
        "./ansible-inventory.yml"
      ],
      "env": {
        "EOS_MCP_PASSWORD": "replace-with-device-password"
      }
    }
  }
}
```

---

## Inventory

### List all devices and groups

> What devices are in the inventory?

> List the inventory

### Check connectivity to all devices

> Probe all the EOS devices in inventory

Example output: 8/8 devices reachable, showing hostname, endpoint IP, and EOS version.

---

## Device Facts

### Collect facts across the entire fabric

> Get facts for all the EOS devices

Returns model, EOS version, serial number, uptime, and system MAC for every host.

---

## Topology

### Generate a topology diagram from LLDP

> Create a topology diagram for all the devices using LLDP neighbors

Claude queries `show lldp neighbors` across all devices, infers the topology, and renders a Mermaid diagram. Example output for a 2-tier spine-leaf lab:

```mermaid
graph TB
    subgraph tier1["Tier 1 — Spine"]
        node1-1["node1-1\n172.20.20.2"]
        node1-2["node1-2\n172.20.20.6"]
    end

    subgraph tier2["Tier 2 — Leaf"]
        node2-1["node2-1\n172.20.20.4"]
        node2-2["node2-2\n172.20.20.5"]
        node2-3["node2-3\n172.20.20.9"]
        node2-4["node2-4\n172.20.20.7"]
        node2-5["node2-5\n172.20.20.3"]
        node2-6["node2-6\n172.20.20.8"]
    end

    node1-1 -- "Et1 ↔ Et1" --- node2-1
    node1-1 -- "Et2 ↔ Et1" --- node2-2
    node1-1 -- "Et3 ↔ Et1" --- node2-3
    node1-1 -- "Et4 ↔ Et1" --- node2-4
    node1-1 -- "Et5 ↔ Et1" --- node2-5
    node1-1 -- "Et6 ↔ Et1" --- node2-6

    node1-2 -- "Et1 ↔ Et2" --- node2-1
    node1-2 -- "Et2 ↔ Et2" --- node2-2
    node1-2 -- "Et3 ↔ Et2" --- node2-3
    node1-2 -- "Et4 ↔ Et2" --- node2-4
    node1-2 -- "Et5 ↔ Et2" --- node2-5
    node1-2 -- "Et6 ↔ Et2" --- node2-6
```

---

## VXLAN

### Check VXLAN status across all leaf switches

> Check on the VXLAN status for all the leaf switches

Claude runs `show vxlan vtep`, `show vxlan vni`, and `show interfaces Vxlan1` and summarizes:

- VTEP source IP and interface per leaf
- VNI-to-VLAN mappings
- Replication mode (headend VCS vs multicast)
- Flood list membership
- Interface line protocol status

### Example findings

```
node2-1  VTEP 192.168.2.3  Loopback1  VNI 1100 → VLAN 100  up
node2-2  VTEP 192.168.2.4  Loopback1  VNI 1100 → VLAN 100  up
node2-3  VTEP 192.168.2.5  Loopback1  VNI 1100 → VLAN 100  up
node2-4  VTEP 192.168.2.6  Loopback1  VNI 1100 → VLAN 100  up
node2-5  VTEP 192.168.2.7  Loopback1  VNI 1100 → VLAN 100  up
node2-6  VTEP 192.168.2.8  Loopback1  VNI 1100 → VLAN 100  up
```

---

## BGP EVPN

### Check EVPN session and route state

> Check on EVPN

Claude runs `show bgp evpn summary` and `show bgp evpn` across all leaves and summarizes:

- Session state per peer (Established / Idle / etc.)
- Prefixes received and advertised per peer
- EVPN route types present (Type-2 MAC/IP, Type-3 IMET, etc.)
- ECMP path count per remote VTEP
- AS path to identify route reflectors and leaf ASNs

### Example findings

All 6 leaves peered to both spines (AS 65000), each leaf with a unique ASN (65001–65006). Only Type-3 IMET routes present — flood list built from EVPN, dual-path ECMP via both spines confirmed.

---

## VLANs

### Inspect a specific VLAN across all leaves

> What can you tell me about VLAN 100?

Claude runs `show vlan 100`, `show mac address-table vlan 100`, and `show interfaces Vlan100` across all leaves and reports:

- VLAN name and status on each leaf
- Which ports are members (access ports, trunk ports, VXLAN tunnel)
- MAC address table entries (learned hosts)
- Whether an SVI exists and its IP/state

### Example findings

VLAN 100 (`VLAN100`) active on all leaves, member of `Vx1` only, empty MAC table, no SVI — fully provisioned L2 overlay segment with no hosts connected yet.

---

## Event Monitor

Requires an operator to start the Event Monitor with `event-monitor` in config mode on the switch (it is stopped by default and the server never starts it); until then queries fail with `event_monitor_not_running`. `eos_run_show` runs `show event-monitor` commands in privileged mode, as the only commands in the request. There is no default row limit, so keep queries narrow. Filters are `%`-wildcard patterns.

### When did a prefix last change?

> When did 10.1.0.0/24 last change on leaf1?

Claude runs `show event-monitor route match-ip 10.1.0.% limit 50` on leaf1 and reads the text rows (output has no JSON form).

### Join across event types with SQL

> Which MACs moved in the last hour?

Claude runs a single `show event-monitor sqlite select ... limit 50` statement. Only one `SELECT` or `WITH` statement is accepted; anything else is rejected with `event_monitor_sqlite_rejected`.

---

## Packet Capture

Enabled by default; denied on hosts that set `mcp_diagnostics_allowed: false` or `mcp_packet_capture_allowed: false`. A capture sees only traffic the switch's control plane sends or receives, never hardware-forwarded transit traffic.

### Check that BGP keepalives are arriving from a peer

> Are BGP packets flowing between node1-1 and node2-1 on Ethernet1?

Claude runs `eos_packet_capture` on node1-1 `Ethernet1` with filter `tcp port 179` and a small `packet_count`, and reads the tcpdump lines it gets back:

```
10.255.255.0.bgp > 10.255.255.1.33219: Flags [P.], ... length 19: BGP
10.255.255.1.33219 > 10.255.255.0.bgp: Flags [.], ack 19, ... length 0
```

### Example findings

A complete capture of 2 packets: a 19-byte BGP message (a keepalive) from node1-1 and node2-1's ACK, both carrying TCP-MD5 options, so the session is alive and authenticated. The same capture with filter `udp port 161` and a 3 s window came back `unfilled`: fewer SNMP packets than requested arrived in the window, which is not proof that none ever do. A malformed filter fails with `packet_capture_filter_rejected` instead of looking like "no traffic".

---

## Available Tools

| Tool | Description |
|---|---|
| `eos_probe_devices` | Validate connectivity, auth, and eAPI reachability |
| `eos_list_inventory` | Show eligible hosts and groups from the loaded inventory |
| `eos_get_facts` | Collect model, version, serial, uptime, system MAC |
| `eos_get_running_config` | Retrieve running config (full for hosts, section for groups) |
| `eos_run_show` | Run arbitrary `show ...` commands, including `show event-monitor` queries; returns JSON or text |
| `eos_show_logging` | Retrieve bounded logging output with minimum severity threshold |
| `eos_get_server_info` | Show server capabilities, runtime mode, inventory summary |
| `eos_ping` | Ping one or more destinations from a host or group (disable with `mcp_diagnostics_allowed: false`) |
| `eos_packet_capture` | Capture control-plane packets on one interface with a pcap filter (disable with `mcp_packet_capture_allowed: false`) |
