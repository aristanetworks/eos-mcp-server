---
name: eos-fabric-report
description: Generate an offline HTML fabric health dashboard from EOS MCP evidence, with topology, link redundancy, and IPv4/EVPN BGP status. Use for visual fabric reports rather than a brief status answer.
allowed-tools: Read, Write, Edit, Bash, mcp__eos__eos_get_server_info, mcp__eos__eos_list_inventory, mcp__eos__eos_probe_devices, mcp__eos__eos_run_show
metadata:
  trigger: HTML fabric dashboard, topology health report, visual redundancy audit
---

# EOS fabric report

Collect live evidence through EOS MCP and generate HTML locally. Device operations
are read-only. Use local tools for report files and rendering, not alternate
device access. This skill is self-contained when installed individually.

## Scope and collection

1. Read `eos_get_server_info` and `eos_list_inventory` for available targets,
   permissions, command-batch/response limits, and server version. Honor the
   user's scope; for a whole-fabric report use the eligible inventory group.
   Resolve ambiguous scope from project context before asking a focused question.
2. Read a user-supplied topology or the workspace's containerlab topology when
   available. Map node names and interfaces to inventory identities. Keep expected
   topology separate from observed topology; without a topology, label the map
   observed-only and leave expected redundancy unknown.
3. Probe the selected targets, then collect these show commands in batches within
   the advertised limits, preferring group calls for identical command sets:

   ```text
   show hostname
   show lldp neighbors detail
   show interfaces status
   show ip bgp summary
   show bgp evpn summary
   ```

   Retain per-device errors. For an unsuccessful batch, isolate the failing command
   before retrying supported commands. Use text output when JSON is unsupported;
   a syntax error is unknown evidence, not proof a feature is unconfigured.
4. Normalize a timestamped snapshot with inventory identity, request parameters,
   collection start/end, command results, and tool errors. `eos_run_show` returns
   per-host `results[]` with `status` and normalized `command_results[]` pairs of
   `command` and `output`. Common JSON fields are
   `vrfs.<vrf>.peers.<address>.peerState`, `asn`, `prefixReceived`, and
   `prefixAccepted`; inspect actual output before relying on a field. Preserve
   interface and LLDP evidence by local interface and remote system/port.

## Findings

- Correlate interface state at both inventory endpoints with expected links.
  Missing LLDP alone does not prove link failure; interface descriptions alone
  do not prove physical neighbors. Keep out-of-scope endpoints visible as such.
- Count physical links once by their endpoint pair. Show BGP counters explicitly
  as per-device neighbor entries, grouped by address family; if drawing session
  edges, deduplicate their two endpoint observations.
- Report management readiness, underlay sessions, overlay sessions, and expected
  uplink redundancy separately. Established sessions do not establish forwarding.
  An unreachable management endpoint remains unknown for direct device evidence.
- A short session uptime is a recent establishment, not proof of repeated flaps.
  Treat reset causes as hypotheses unless corroborated. For cEOS, focus on
  logical/link/protocol state rather than inferred CRC, optics, or ASIC faults.

## HTML artifact

Default output: `.local-artifacts/reports/fabric-health.html`; honor a requested
path. Save sanitized evidence alongside it as `fabric-health.json`. Create the
directory as needed and preserve prior reports with a timestamped filename.

Use a polished operations-dashboard layout: dark navy header, light panels,
system fonts, generous spacing, teal/amber/red status accents with text labels,
and a separate neutral unknown state. Build an inline SVG topology with spines
above leaves when roles are known; otherwise use neutral discovered roles.
Keep overlapping links readable with labels and ample space.

Include:

- Summary cards with explicit denominators for readiness, links, and BGP state.
- A topology where selecting a node or link opens its evidence and findings.
- A leaf/uplink redundancy table, findings ranked by observed impact, and a
  sortable device/neighbor table. Include an empty state when no devices respond.
- Expandable command evidence with collection times and exact commands.

Make HTML self-contained with embedded CSS/JS/data, inline SVG, and no external
requests. Escape device text and use `textContent` for dynamic values. Serialize
embedded JSON safely, including `<` as `\u003c` so data cannot terminate a script
element. Redact secrets before writing either artifact. Label facts, hypotheses,
unsupported checks, and errors distinctly; invent no history or health score.
Use keyboard-operable controls, SVG accessible names, responsive layout, and
print CSS that preserves findings and tabular evidence.

## Verify and deliver

Check totals against the saved snapshot, missing-data states, relative paths,
and inline JavaScript syntax. If a browser is available, open the local artifact,
check wide/narrow layouts and keyboard selection, and inspect runtime errors.
Otherwise state that visual verification was unavailable. Return clickable HTML
and evidence links with the main finding and collection scope. Completion means
real evidence is saved and the report is generated; a proposed layout alone is
not the deliverable.
