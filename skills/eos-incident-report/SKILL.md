---
name: eos-incident-report
description: Build a resumable offline HTML EOS incident report comparing baseline, degraded, and recovered snapshots around an operator-staged network event. Use for visual before/after incident evidence.
allowed-tools: Read, Write, Edit, Bash, mcp__eos__eos_get_server_info, mcp__eos__eos_list_inventory, mcp__eos__eos_run_show, mcp__eos__eos_ping, mcp__eos__eos_show_logging
metadata:
  trigger: HTML incident report, baseline degraded recovered comparison, visual fault recovery report
---

# EOS incident report

Collect evidence through EOS MCP and build HTML locally. Device operations are
inspection and bounded pings. The operator stages/restores faults using their
own access; this skill does not change configuration or bypass MCP to do so.
This skill is independently installable and supports work across turns.

## Establish or resume an incident

1. Resolve the affected inventory device/interface and peer, destination,
   source address, VRF, and intended incident from the request and topology.
   Ask only for missing parameters that determine the test. Use unique remote
   endpoints rather than shared anycast gateways. Read server limits and
   inventory diagnostic permissions before collection.
2. Use a user-selected incident directory, otherwise
   `.local-artifacts/reports/incidents/<UTC-timestamp>/`. On resume, load its
   saved manifest. If several incidents could match, ask which one. Never
   silently resume an unrelated incident or replace a completed phase.
3. Write `incident.json` with scope, a stable test plan, expected topology,
   phase statuses, snapshot filenames, collection intervals, and operator event
   times. Record the timestamp's source: operator-reported, device event, or
   local observation. Preserve existing snapshots when recollecting a phase by
   versioning them and identifying the selected version in the manifest.

## Collect one phase at a time

Phases are `baseline`, `degraded`, and `recovered`. Collect only phases that the
operator says are ready. After saving a baseline, report its location and the
next phase to collect when the operator has staged the fault. Resume when the
operator provides that readiness; do not block on a long-running polling loop.
An existing fault cannot retroactively supply a healthy baseline: mark it missing
unless compatible earlier evidence is provided and clearly attributed.

For an uplink incident, capture at each phase:

- Both endpoint interface states, using focused `show interfaces <interface>`
  and/or `show interfaces status`.
- Both endpoints' `show ip bgp summary` and `show bgp evpn summary`.
- The source device's `show ip route <destination>` in the default VRF or
  `show ip route vrf <vrf> <destination>` in a tenant context.
- `eos_ping` from the same inventory host, source, VRF, and destination, with
  three packets by default. Preserve execution errors separately from loss.
- Relevant `eos_show_logging` output, if available. Set `minimum_severity` to
  `informational` to include informational link/BGP events; respect message
  limits. Record when bounded logs do not cover the event.

Batch identical show sets within current limits; isolate unsupported commands
and retain their errors. Read `results[].command_results[].output` for show
evidence and `results[].finding` for ping measurements. Common route fields are
`vrfs.<vrf>.routes.<prefix>.vias[]`, containing interface/next-hop or VTEP/VNI
information; inspect actual output before comparing.

Save a sanitized `<phase>.json` immediately with request parameters, collection
start/end, normalized observations, and errors; then update the manifest.
Keep measurement parameters fixed across phases, or flag changes that prevent
direct comparison. A phase may contain partial evidence without being healthy.

## Generate the HTML

Create or refresh `incident.html` in the incident directory after each collected
phase and when the user requests a report. Show pending/missing phases visibly;
call the full comparison complete only once all three phases are collected.
If the user wants a partial report, deliver it clearly labeled as partial.

Use a dark navy header, light content panels, clear typography, generous spacing,
and text-labeled teal/amber/red states with neutral unknowns. Include:

- Three aligned baseline/degraded/recovered panels with timestamps.
- Inline SVG topology per phase highlighting affected and surviving paths.
- Route next-hop and BGP/interface differences linked to evidence.
- Measured loss/RTT charts with units and unavailable samples left blank.
- A timeline distinguishing operator actions, collection intervals, and device
  log times; identify timezones and clock uncertainty across devices.
- An impact/recovery narrative with expandable command evidence and error details.

Generate one offline HTML with embedded CSS/JS/SVG/data, system fonts, responsive
layout, print CSS, and keyboard-operable controls. Redact secrets from HTML and
JSON; escape text and use `textContent` for dynamic values. Encode `<` as
`\u003c` in embedded JSON to prevent closing a script element through data.

Separate facts from hypotheses. Three snapshots establish observed states at
collection, not convergence time, continuous availability, or outage duration.
Management reachability, surviving routes, and tenant forwarding are separate
findings. Avoid physical-hardware conclusions from cEOS evidence.

## Verify and deliver

Reconcile phase cards/charts with persisted snapshots and check manifest links.
Validate inline JavaScript syntax; if a browser is available, inspect wide/narrow
layouts, phase comparisons, timeline, and evidence controls. Otherwise state
that visual verification was unavailable. Return a clickable HTML link and the
incident directory/manifest, phase completeness, and the next phase when pending.
