# EOS MCP Server Skills

Operational skills for interacting with Arista EOS devices via the `eos` MCP server. Each skill is a Markdown file that teaches an AI coding assistant (Claude Code, Codex, etc.) how to use specific EOS commands to accomplish a task.

## Available skills

| Skill                                                         | Trigger                                                     | Description                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [check-bgp-health](check-bgp-health/SKILL.md)                       | BGP/EVPN status, fabric health                              | Audit BGP and EVPN neighbor state across devices                                       |
| [check-evpn-health](check-evpn-health/SKILL.md)                     | EVPN, VXLAN, VTEPs, VNI, MAC mobility, multihoming, gateway | Full EVPN stack audit: control plane, data plane, multihoming, multicast, L3 gateway   |
| [check-evpn-multicast-health](check-evpn-multicast-health/SKILL.md) | EVPN multicast, IMET, SMET, S-PMSI, OISM, PEG               | Audit EVPN multicast health for L2 optimized multicast and L3 EVPN multicast/IRB       |
| [check-igmp-health](check-igmp-health/SKILL.md)                     | IGMP snooping, multicast groups, querier                    | Audit IGMP snooping state, group membership, querier election                          |
| [check-interface-health](check-interface-health/SKILL.md)           | Interface status, errors, errdisabled, optics               | Audit interface link state, error counters, traffic rates, and transceiver health      |
| [check-port-channel-health](check-port-channel-health/SKILL.md)     | Port-Channel, LAG, LACP, bundled members, dot1q-tunnel      | Audit Port-Channel/LACP members and switchport mode/VLAN state                         |
| [check-pim-health](check-pim-health/SKILL.md)                       | PIM neighbors, RP, mroute, multicast routing                | Audit PIM-SM adjacencies, RP election, multicast routing table                         |
| [check-route-health](check-route-health/SKILL.md)                   | Routes, VRF, routing table, FIB                             | Audit routing table and VRF health — route counts, protocol status, hardware resources |
| [check-vlan-health](check-vlan-health/SKILL.md)                     | VLAN, SVI, trunk, MAC table                                 | Audit VLAN health — status, port membership, SVI state, trunk config, MAC anomalies    |

## How skills work

Skills are loaded by AI coding assistants as contextual instructions. When a user asks a question that matches a skill's trigger, the assistant follows the skill's procedures to query devices via the MCP server and present structured results.

Each skill defines:

- **Trigger conditions** — when to activate
- **Target resolution** — how to identify which devices to query
- **Commands** — which `show` commands to run and how to batch them
- **Output parsing** — how to interpret eAPI JSON responses
- **Diagnostic drill-downs** — what to investigate when something is wrong
- **Output format** — how to present results to the user

## Writing a new skill

1. Create a new directory with your skill name
2. Add a `SKILL.md` file in the directory
3. Add frontmatter with `name`, `description`, `trigger`, and `allowed-tools`
4. Keep the skill **read-only** — never modify device configuration
5. Keep it **generic** — no site-specific group names, inventory layouts, or deployment conventions
6. Prefer group targets over per-host loops for efficiency
7. Document the EOS commands used and their expected JSON output structure
8. Include diagnostic procedures for common failure modes

## Using skills with Claude Code

If the `eos-mcp-server` repo is checked out locally, symlink the skills directory into your project:

```bash
ln -s /path/to/eos-mcp-server/skills /path/to/your/project/.claude/skills/eos
```

Skills will be automatically discovered and loaded by Claude Code when working in the project.
