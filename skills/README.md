# EOS MCP Server Skills

Operational skills for interacting with Arista EOS devices via the `eos` MCP server. Each skill is a Markdown file that teaches an AI coding assistant (Claude Code, Codex, etc.) how to use specific EOS commands to accomplish a task.

## Available skills

| Skill                                                                 | Trigger                                                     | Description                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [check-bgp-health](check-bgp-health/SKILL.md)                         | BGP/EVPN status, fabric health                              | Audit BGP and EVPN neighbor state across devices                                       |
| [check-evpn-health](check-evpn-health/SKILL.md)                       | EVPN, VXLAN, VTEPs, VNI, MAC mobility, multihoming, gateway | Full EVPN stack audit: control plane, data plane, multihoming, multicast, L3 gateway   |
| [check-evpn-multicast-health](check-evpn-multicast-health/SKILL.md)   | EVPN multicast, IMET, SMET, S-PMSI, OISM, PEG               | Audit EVPN multicast health for L2 optimized multicast and L3 EVPN multicast/IRB       |
| [check-igmp-health](check-igmp-health/SKILL.md)                       | IGMP snooping, multicast groups, querier                    | Audit IGMP snooping state, group membership, querier election                          |
| [check-interface-health](check-interface-health/SKILL.md)             | Interface status, errors, errdisabled, optics               | Audit interface link state, error counters, traffic rates, and transceiver health      |
| [check-port-channel-health](check-port-channel-health/SKILL.md)       | Port-Channel, LAG, LACP, bundled members, dot1q-tunnel      | Audit Port-Channel/LACP members and switchport mode/VLAN state                         |
| [check-pim-health](check-pim-health/SKILL.md)                         | PIM neighbors, RP, mroute, multicast routing                | Audit PIM-SM adjacencies, RP election, multicast routing table                         |
| [check-route-health](check-route-health/SKILL.md)                     | Routes, VRF, routing table, FIB                             | Audit routing table and VRF health — route counts, protocol status, hardware resources |
| [check-vlan-health](check-vlan-health/SKILL.md)                       | VLAN, SVI, trunk, MAC table                                 | Audit VLAN health — status, port membership, SVI state, trunk config, MAC anomalies    |
| [rfc-9721-validation](rfc-9721-validation/SKILL.md)                   | EVPN IP mobility, MAC-IP moves, duplicate address detection | Validate RFC 9721 EVPN-IRB IP mobility and duplicate host detection                    |
| [troubleshoot-segment-routing](troubleshoot-segment-routing/SKILL.md) | Troubleshoot ISIS-SR, missing SIDs or labels, TI-LFA        | Diagnose ISIS Segment Routing faults using a structured validation workflow            |
| [validate-segment-routing](validate-segment-routing/SKILL.md)         | ISIS-SR, SIDs, SRGB, MPLS labels, TI-LFA                    | Audit ISIS Segment Routing operational state and protection health                     |
| [mcs-config-validate](mcs-config-validate/SKILL.md)                   | MCS/CVX configuration, Purple switches, CVX clusters       | Validate CVX server and EOS client MCS configuration and known version risks           |
| [mcs-mounts](mcs-mounts/SKILL.md)                                    | MCS mounts, CVX connections, error 199                     | Diagnose incomplete mounts, cluster asymmetry, and Purple dual-homing                 |
| [mcs-agents](mcs-agents/SKILL.md)                                    | MCS agent health, crashes, restarts, API status             | Diagnose MCS agents without restarting production agents                               |
| [multicast-triage](multicast-triage/SKILL.md)                         | Multicast symptoms and diagnostic routing                  | Classify multicast failures and route to the appropriate workflow                     |
| [multicast-flow-missing](multicast-flow-missing/SKILL.md)             | Missing multicast flow or receiver delivery                | Trace IGMP membership, PIM state, mroute, MFIB, and RPF evidence                      |
| [multicast-flow-drops](multicast-flow-drops/SKILL.md)                 | Intermittent multicast loss and state cycling              | Correlate IGMP churn, PIM transitions, drops, and forwarding state                   |
| [multicast-flow-corrupt](multicast-flow-corrupt/SKILL.md)             | Corrupted, duplicated, or mixed multicast flows             | Diagnose interface, ASIC, CoPP, MMU, RPF, aliasing, and PTP evidence                 |
| [ptp-triage](ptp-triage/SKILL.md)                                     | PTP synchronization and unclear timing symptoms             | Classify PTP issues and route to GM or connectivity diagnostics                        |
| [ptp-gm](ptp-gm/SKILL.md)                                            | PTP grandmaster election and BMCA                            | Diagnose wrong-GM and GM-oscillation problems                                          |
| [ptp-debug](ptp-debug/SKILL.md)                                      | PTP connectivity, delay, domain, and packet issues          | Diagnose missing delay responses, source IP, domain, and message failures              |

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

## Installing skills

Skills aren't included in the npm package. Clone this repository, then link each skill folder into the skills directory your assistant reads. Both assistants follow symlinks, so a `git pull` in the clone updates every linked skill.

Link each skill folder individually. Claude Code only discovers skills one level deep (`<skills-dir>/<skill-name>/SKILL.md`), so linking the whole `skills/` folder as a single subdirectory won't load anything.

```bash
git clone https://github.com/aristanetworks/eos-mcp-server.git
EOS_SKILLS=$PWD/eos-mcp-server/skills

# Pick the destination for your assistant and scope (see the sections below)
DEST=~/.claude/skills

mkdir -p "$DEST"
for skill in "$EOS_SKILLS"/*/; do
  ln -sfn "$skill" "$DEST/$(basename "$skill")"
done
```

To install only some skills, link just those folders, for example `ln -sfn "$EOS_SKILLS/check-bgp-health" "$DEST/check-bgp-health"`. Remove a skill by deleting its symlink.

Each assistant also needs the `eos` MCP server configured, so the skills can call its tools. See [Connect to an MCP client](../README.md#connect-to-an-mcp-client).

## Using skills with Claude Code

| Scope | `DEST` |
| --- | --- |
| All your projects | `~/.claude/skills` |
| One project | `/path/to/your/project/.claude/skills` |

Claude Code discovers new skills automatically. Start a new session if a skill doesn't appear.

## Using skills with Codex

| Scope | `DEST` |
| --- | --- |
| All your projects | `~/.agents/skills` |
| One project | `/path/to/your/project/.agents/skills` |

Older Codex releases read `~/.codex/skills` and `.codex/skills` instead, and current releases still support them. Restart Codex after adding skills.
