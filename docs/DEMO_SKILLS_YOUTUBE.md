# Five-minute demo: EOS MCP Server + Skills

**Suggested YouTube title:** Arista EOS + AI Skills: Get Started with Claude Code and Codex

**Audience:** Network engineers who are new to AI skills. No MCP or skills experience assumed; basic familiarity with switches and BGP helps.

**Format:** Screen recording with voiceover. Show installation for both clients, then run BGP health in Claude Code and interface health in Codex. Aim for five minutes after trimming downloads and tool waits. The server connection is prepared before recording; the complete setup is included below for the video description or companion notes.

**Recording environment:** Use `example-codex/eos-mcp-server-config.yml` for both clients. It selects `clab/ansible-inventory.yml` for the containerlab topology in `clab/testlab.clab.yaml`: eight cEOS nodes, with two spines and six leaves. This demonstration focuses on BGP and virtual link state; CRC errors and physical optics diagnostics are not demonstration goals.

Only text marked **Say** is narration. **Screen** and **Presenter notes** are production directions. Results must come from the recording lab; the script does not assume a particular fault or invent output.

## Recording script

### 0:00–0:20 — Hook

**Screen:** Start with a readable BGP report from a rehearsed lab run, then show the two client terminals labeled “Claude Code” and “Codex.”

**Say:**

> What if you could ask your AI assistant to check BGP or verify your lab links, using a runbook you can actually read?
>
> In this video, we'll install skills for the EOS MCP server in both Claude Code and Codex, then try two everyday network checks.

### 0:20–0:55 — What is a skill?

**Screen:** Open `skills/check-bgp-health/SKILL.md`. Highlight its name, description, commands, and report format. Use this simple overlay:

```text
You ask a question
       ↓
AI assistant follows a skill (the runbook)
       ↓
EOS MCP server provides tools
       ↓
Arista EOS devices return live data through eAPI
```

**Say:**

> A skill is a reusable set of instructions for an AI assistant. Think of it as a runbook: what to check, which commands to use, what to investigate next, and how to report the findings.
>
> The MCP server provides access to device data. The skill provides the procedure for using that data.
>
> This BGP skill is a Markdown file. You can inspect its checks and reporting instructions before using it. These EOS workflows are read-only.

### 0:55–1:15 — Introduce the lab

**Screen:** Show `example-codex/eos-mcp-server-config.yml`, then the `arista_ceos` group in `clab/ansible-inventory.yml` and the topology in `clab/testlab.clab.yaml`. Briefly show `eos` connected in each client's `/mcp` view. Prepare those views in advance.

**Say:**

> Both clients use the example-codex server config, pointing to our containerlab inventory. We have eight cEOS switches: two spines and six leaves, in the “arista_ceos” group.
>
> These are containers, so we'll check BGP and virtual links. The inventory defines our targets.

### 1:15–2:05 — Install skills in both clients

**Screen:** Show the clone step as a command card for viewers, then run the remaining commands from the existing recording checkout at `/home/fred/aristanetworks/eos-mcp-server`. The local containerlab is already prepared there.

```bash
git clone https://github.com/aristanetworks/eos-mcp-server.git
cd eos-mcp-server

mkdir -p .claude/skills .agents/skills
```

```bash
# Claude Code
ln -s "$PWD/skills/check-bgp-health" .claude/skills/
ln -s "$PWD/skills/check-interface-health" .claude/skills/
ln -s "$PWD/skills/check-route-health" .claude/skills/

# Codex
ln -s "$PWD/skills/check-bgp-health" .agents/skills/
ln -s "$PWD/skills/check-interface-health" .agents/skills/
ln -s "$PWD/skills/check-route-health" .agents/skills/
```

**Say:**

> The skills live in the GitHub repository and are separate from the server's npm package. First, clone the repository.
>
> Claude Code looks in dot-claude slash skills. Codex looks in dot-agents slash skills. We create both folders.
>
> We're installing three workflows: BGP health, interface health, and route health. Each command links one skill folder into one client. Three for Claude Code, then the same three for Codex.
>
> Both clients now point at the same skill folders in this project.
>
> Keep the clone in place because the links point to it. Now open a fresh session in each client. In Claude Code, type slash to find a skill. In Codex, use slash-skills or type a dollar sign.

**Presenter notes:** Show each selector briefly. These are project-level installations; launch both clients in the project where you installed the links. The automated recording uses an isolated project under `.local-artifacts/eos-skills-demo/workspace`, with links back to this checkout's `skills/` folder. The clone command is shown as a viewer setup step because the recording checkout already exists. For installation across all projects, use the user-level destinations documented in `skills/README.md`. Each `ln -s` links into the client's skills folder, keeping the skill's folder name, and fails rather than overwriting if that name already exists; if a destination already exists, inspect it during rehearsal and reuse it if appropriate. Link individual skill folders, each containing `SKILL.md`.

Discovery locations and invocation syntax are documented in [Claude Code Skills](https://code.claude.com/docs/en/skills) and [OpenAI's Codex skills documentation](https://learn.chatgpt.com/docs/build-skills).

### 2:05–3:10 — Scenario 1: BGP health in Claude Code

**Screen:** In Claude Code, select `/check-bgp-health` and submit:

```text
/check-bgp-health Check the arista_ceos inventory group. Summarize neighbor states,
prefix counts, and uptime. Separate observed problems from possible causes,
and report any devices or checks you could not assess.
```

**Say while the request runs:**

> First: a fabric-wide BGP check. I'm choosing the skill explicitly and targeting the arista_ceos group, covering all eight switches.
>
> The skill asks for IPv4, IPv6, and EVPN summaries. The server queries the devices, and the assistant turns the results into a report.

**Screen:** Expand one `eos_run_show` call. Highlight the group target and command list, then return to the report.

**Say:**

> Notice the group target and the commands behind the answer. We can inspect the evidence.
>
> Look for Established sessions, prefix counts, and recent session starts. A short uptime means a session started recently; we need more evidence to call it repeated flapping.
>
> If a session is down, the skill can check neighbor details. A possible cause still needs supporting evidence.

**Presenter notes:** Point to actual values. If all sessions are Established, say “The queried sessions are Established in this snapshot.” If there is a failure, identify the observed state and any retrieved reset reason. Never narrate a specific cause unless the result supports it. Distinguish an explicitly unconfigured address family from an unsupported command or failed query.

### 3:10–4:15 — Scenario 2: Interface health in Codex

**Screen:** Switch to Codex. Select `$check-interface-health` and submit:

```text
$check-interface-health Check node2-1. Its expected uplinks are Ethernet1
toward node1-1 and Ethernet2 toward node1-2. Report observed link states
and descriptions, and flag any expected uplink that is down. This is a
cEOS containerlab: skip optics and physical hardware diagnostics. Treat
unused ports separately and report any checks you could not complete.
```

**Say:**

> Now let's use Codex to verify the links on node2-1. Codex uses a dollar sign to select the skill; Claude Code uses a slash. Both clients can use these same workflow files.
>
> This leaf has two expected uplinks: Ethernet1 toward node1-1, and Ethernet2 toward node1-2.

**Screen:** Show the initial `show interfaces status` and `show interfaces counters errors` tool inputs, followed by the report. Highlight `Ethernet1` and `Ethernet2` and compare their observed state and descriptions with the topology.

**Say:**

> Check whether both expected uplinks are connected. An unused, disconnected port elsewhere may be expected.
>
> The skill also reads error counters, but this container demo isn't a physical cable test. We're demonstrating link state, with no CRC errors expected.
>
> If both uplinks are up, that's a useful result: we've checked the expected connections and can inspect the evidence.

**Presenter notes:** A healthy report is the planned outcome; do not introduce a fault or wait for CRC errors. The topology defines the intended links, while the live tool output establishes their current state. Skip transceiver DOM, physical cable fault diagnosis, and ASIC resource checks in this cEOS demo.

### 4:15–4:40 — More usage scenarios

**Screen:** Show a prompt card rather than waiting for a third live workflow:

```text
Use check-route-health on node2-1. Summarize VRFs and route counts.
This is cEOS: skip hardware capacity checks. Flag unexpected empty
tables and state what you could not verify.
```

**Say:**

> We also installed route health, which checks VRFs and routing tables.
>
> You can use these skills for morning checks, after maintenance, or to collect evidence for an incident. You can ask in ordinary language too; the assistant may select a matching skill. Naming it explicitly makes the workflow easier to follow in a demo.

### 4:40–5:00 — Close

**Screen:** Return to the skill file beside one completed report. End card: repository link and “Read the runbook • Choose a target • Inspect the results.”

**Say:**

> To get started, connect the EOS MCP server, install the skill folders, and choose a target from your inventory.
>
> The server provides the device tools. Skills turn those tools into reusable workflows you can inspect and share.
>
> The repository, setup instructions, and example prompts are linked below. Try one check in your lab and inspect the results.

## Presenter preparation — outside the five-minute cut

### Prerequisites and lab

- Bash on Linux, macOS, or WSL; Git; Node.js **24+**, as required by the current `package.json`.
- Claude Code and Codex CLI installed, signed in, and ready. Use their official setup guides for client installation.
- The existing `clab/testlab.clab.yaml` containerlab, with HTTPS eAPI reachable on all eight cEOS nodes and credentials authorized to run the checks.
- The lab's routing configuration already deployed. The topology alone defines nodes and links; it does not establish BGP configuration or live neighbor health. Rehearse against the deployed lab; IPv6 BGP may be unconfigured.
- A sanitized inventory and terminal layout suitable for publication. Enter credentials off camera and keep saved credential configuration out of the recording.

Use a disposable demo workspace or a dedicated recording account so unrelated MCP servers and duplicate skill names do not clutter the selectors. Rehearse both clients against the same lab. No fault is required for a useful demo.

### Use the existing config and containerlab inventory

Use `example-codex/eos-mcp-server-config.yml` unchanged for this recording. It contains:

```yaml
inventory: /home/fred/aristanetworks/eos-mcp-server/clab/ansible-inventory.yml
```

The inventory defines group **`arista_ceos`** with `node1-1`, `node1-2`, and `node2-1` through `node2-6`. It supplies the `admin` username, `EOS_MCP_PASSWORD` password reference, and disabled certificate validation for the lab. Use the existing password for these devices.

The topology specifies `ceos-lab:4.34.3M` and connects each leaf to both spines. The selected leaf's intended links are:

| Leaf interface | Spine interface |
| --- | --- |
| `node2-1:Ethernet1` | `node1-1:Ethernet1` |
| `node2-1:Ethernet2` | `node1-2:Ethernet1` |

`clab/` is ignored by Git in this checkout. A fresh public clone supplies the skills but does not supply this local lab. The recording uses the existing checkout; viewers using another lab must provide their own inventory and adjust the absolute inventory path in their server config.

In Bash, enter the password without placing its literal value in shell history:

```bash
read -rsp 'EOS lab password: ' EOS_MCP_PASSWORD
printf '\n'
export EOS_MCP_PASSWORD

# Recording checkout; viewers substitute their own checkout/config path.
EOS_DEMO_REPO="/home/fred/aristanetworks/eos-mcp-server"
EOS_DEMO_CONFIG="$EOS_DEMO_REPO/example-codex/eos-mcp-server-config.yml"

npx -y @aristanetworks/eos-mcp-server validate-inventory \
  --config "$EOS_DEMO_CONFIG"

npx -y @aristanetworks/eos-mcp-server probe \
  --config "$EOS_DEMO_CONFIG" --target arista_ceos
```

`validate-inventory` checks inventory and connection settings, including password resolution; it does not contact the devices. `probe` makes live device requests. Proceed to recording once all eight devices probe successfully.

### Register the server in both clients

Run these commands in the same shell as the exported password and absolute config path. Both clients use the config in `example-codex`. Register the server as **`eos`** because the skill files refer to that server's tools.

**Claude Code:**

```bash
claude mcp add --scope user --transport stdio eos \
  --env EOS_MCP_PASSWORD="$EOS_MCP_PASSWORD" \
  -- npx -y @aristanetworks/eos-mcp-server serve \
  --config "$EOS_DEMO_CONFIG"
```

**Codex:**

```bash
codex mcp add eos \
  --env EOS_MCP_PASSWORD="$EOS_MCP_PASSWORD" \
  -- npx -y @aristanetworks/eos-mcp-server serve \
  --config "$EOS_DEMO_CONFIG"
```

These CLI examples store the expanded password in each client's saved configuration. Keep those files private and off camera. For Codex, you can instead configure dynamic environment forwarding in `~/.codex/config.toml`:

```toml
[mcp_servers.eos]
command = "npx"
args = ["-y", "@aristanetworks/eos-mcp-server", "serve", "--config", "/home/fred/aristanetworks/eos-mcp-server/example-codex/eos-mcp-server-config.yml"]
env_vars = ["EOS_MCP_PASSWORD"]
```

Use this TOML table as an alternative to the CLI-created entry, replacing its stored `env` password entry; do not append a duplicate table. Launch Codex from a shell where the password is exported. See the [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for client configuration details.

The MCP client launches the server; you do not need a separate foreground `serve` process. Download the npm package during rehearsal. For repeatable recordings, choose and pin a released package version in both client commands and record the Git commit used for the skills.

### Verify installation before recording

1. Run the skill-link commands from the recording script. If a skill already exists, inspect its destination rather than overwriting it.
2. Launch `claude` and `codex` in separate terminals. In each client, check `/mcp` for the `eos` server and its tools.
3. Confirm the three skill names appear: type `/check-` in Claude Code; use `/skills` or `$check-` in Codex. Restart a client if newly added skills are missing.
4. Ask each client: “Use eos_list_inventory to list the available EOS hosts and groups.” Confirm all eight lab nodes and the `arista_ceos` group appear.
5. Rehearse both prompts. Confirm the assistant loads the named skill and calls EOS MCP tools rather than answering from general knowledge.

## Prompt reference and optional follow-ups

| Scenario | Claude Code | Codex |
| --- | --- | --- |
| Fabric BGP health | `/check-bgp-health Check arista_ceos.` | `$check-bgp-health Check arista_ceos.` |
| Virtual uplink state | `/check-interface-health Check node2-1 uplinks Ethernet1 and Ethernet2; skip optics.` | `$check-interface-health Check node2-1 uplinks Ethernet1 and Ethernet2; skip optics.` |
| Routing and VRFs | `/check-route-health Check VRFs and route counts on node2-1; skip hardware checks.` | `$check-route-health Check VRFs and route counts on node2-1; skip hardware checks.` |

Useful follow-ups in either client:

```text
Which findings are directly supported by device output, and which are hypotheses?
```

```text
Recheck Ethernet1 and Ethernet2 on node2-1. Compare their current link states
with the previous reading and summarize any changes. Keep this read-only.
```

```text
Summarize the results in five lines for an incident handoff, including targets,
observations, checks that failed, and the next read-only investigation.
```

The repository also has EVPN, Port-Channel, VLAN, multicast, PTP, and Segment Routing workflows. Introduce these as follow-up topics; keep the first video focused on the two live checks.

## Recording contingencies

| What happens | Presenter response |
| --- | --- |
| Everything looks healthy | Explain the observed states and counts. A healthy lab is a valid demonstration. |
| Interface counters are all zero | Continue with the expected-uplink state check. CRC faults and optics alarms are not expected demonstrations in this container lab. |
| Skill missing from a selector | Check the per-skill link and `SKILL.md`, then restart the client. Fix this during rehearsal. |
| Server connected, devices unreachable | Check inventory, eAPI reachability, credentials, and TLS. A connected MCP server does not establish device connectivity. |
| An EOS command is unsupported | Report that check as unavailable. Do not convert a command failure into a healthy result or a missing-feature claim. |
| A skill overstates a cause | Point back to the evidence and ask it to separate observations from hypotheses. |
| A tool call takes too long for the edit | Trim the wait while retaining the submitted prompt, an actual tool call, and the returned report. |

Keep screenshots from a successful rehearsal as a fallback, clearly labeled “recorded lab result” if inserted. Do not substitute fabricated device output. Show one short tool trace per client and spend the remaining time explaining the reports.

## Suggested video description

```text
Learn what AI skills are and use them with the Arista EOS MCP server in
Claude Code and Codex. We install shared workflow files, then check BGP
neighbors and virtual uplink state against an eight-node cEOS containerlab.
Both clients use example-codex/eos-mcp-server-config.yml and the local
clab inventory. This demo does not depend on CRC errors or physical optics.

00:00 What we'll build
00:20 Skills and MCP explained
00:55 The lab
01:15 Install skills for Claude Code and Codex
02:05 BGP health in Claude Code
03:10 Interface health in Codex
04:15 More workflows
04:40 Getting started

Repository: https://github.com/aristanetworks/eos-mcp-server
Skills and installation: https://github.com/aristanetworks/eos-mcp-server/tree/main/skills
Server setup: https://github.com/aristanetworks/eos-mcp-server#connect-to-an-mcp-client

Requires reachable Arista EOS devices with eAPI, Node.js 24+, and your
chosen AI client. These workflows use read-only device tools.
```

Adjust chapter timestamps to match the final edit.

## Verification notes

Prepared against this checkout's `skills/README.md`, the BGP/interface/route skill files, MCP tool schemas, CLI implementation, and `package.json`. Lab targets and intended links were checked against `example-codex/eos-mcp-server-config.yml`, `clab/ansible-inventory.yml`, and `clab/testlab.clab.yaml`. Client registration syntax was checked with installed Codex CLI 0.163.0 and Claude Code 2.1.306 help, and skill discovery/invocation was checked against the linked official documentation. Live lab outputs and recording timings must be rehearsed in the presenter's environment.
