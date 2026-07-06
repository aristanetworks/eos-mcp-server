# EOS MCP Server Skills

Operational skills for interacting with Arista EOS devices via the `eos` MCP server. Each skill is a Markdown file that teaches an AI coding assistant (Claude Code, Codex, etc.) how to use specific EOS commands to accomplish a task.

## Available skills

| Skill | Trigger | Description |
|---|---|---|
| [check-bgp-health](check-bgp-health.md) | BGP/EVPN status, fabric health | Audit BGP and EVPN neighbor state across devices |
| [check-evpn-health](check-evpn-health.md) | EVPN, VXLAN, VTEPs, VNI, MAC mobility, multihoming, gateway | Full EVPN stack audit: control plane, data plane, multihoming, multicast, L3 gateway |
| [check-igmp-health](check-igmp-health.md) | IGMP snooping, multicast groups, querier | Audit IGMP snooping state, group membership, querier election |
| [check-interface-health](check-interface-health.md) | Interface status, errors, errdisabled, optics | Audit interface link state, error counters, traffic rates, and transceiver health |
| [check-pim-health](check-pim-health.md) | PIM neighbors, RP, mroute, multicast routing | Audit PIM-SM adjacencies, RP election, multicast routing table |
| [check-route-health](check-route-health.md) | Routes, VRF, routing table, FIB | Audit routing table and VRF health — route counts, protocol status, hardware resources |
| [check-vlan-health](check-vlan-health.md) | VLAN, SVI, trunk, MAC table | Audit VLAN health — status, port membership, SVI state, trunk config, MAC anomalies |

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

1. Create a new `.md` file in this directory
2. Add frontmatter with `name`, `description`, `trigger`, and `allowed-tools`
3. Keep the skill **read-only** — never modify device configuration
4. Keep it **generic** — no site-specific group names, inventory layouts, or deployment conventions
5. Prefer group targets over per-host loops for efficiency
6. Document the EOS commands used and their expected JSON output structure
7. Include diagnostic procedures for common failure modes

## Using skills with Claude Code

If the `eos-mcp-server` repo is checked out locally, symlink the skills directory into your project:

```bash
ln -s /path/to/eos-mcp-server/skills /path/to/your/project/.claude/skills/eos
```

Skills will be automatically discovered and loaded by Claude Code when working in the project.
