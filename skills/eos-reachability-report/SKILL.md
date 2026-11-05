---
name: eos-reachability-report
description: Generate offline HTML directed reachability heatmaps using EOS MCP source-pinned pings, comparing VTEP underlay and selected tenant VRFs. Use for visual connectivity and RTT reports.
allowed-tools: Read, Write, Edit, Bash, mcp__eos__eos_get_server_info, mcp__eos__eos_list_inventory, mcp__eos__eos_run_show, mcp__eos__eos_ping
metadata:
  trigger: HTML ping matrix, VTEP reachability heatmap, tenant connectivity report
---

# EOS reachability report

Use EOS MCP for live discovery and bounded pings; generate HTML locally. Device
configuration stays unchanged. Local tools serve file generation and rendering,
not alternate device access. This skill is independently installable.

## Discover the test plan

1. Get inventory permissions and server limits with `eos_list_inventory` and
   `eos_get_server_info`. Use inventory host/group names as execution targets;
   diagnostic destinations are address literals. Honor the requested scope and
   contexts. Prefer discovered workspace context over asking for known details.
2. On candidate devices, collect `show interfaces vxlan 1`, `show vrf`, and
   `show ip interface brief` within command-batch limits. Discover the actual
   VTEP source interface rather than assuming Loopback1. If needed, query
   `show ip interface vrf <vrf> brief` or a focused interface/VRF config section
   through show commands to establish address membership unambiguously.
   Handle unsupported syntax explicitly and use supported text output if needed.
3. For underlay, use each active VTEP's source address in the default VRF. Add
   tenant contexts requested by the user or clearly supplied by the lab's unique
   diagnostic loopbacks. Associate each source/destination with device and VRF.
   Shared anycast gateway addresses cannot identify a remote endpoint. Mark
   missing or ambiguous addresses unavailable rather than choosing a fallback.
4. Construct the planned directed paths excluding self-tests. Default to one
   complete round with three packets per path unless the user specifies another
   budget. State the plan before dispatch. For N devices and C complete contexts,
   each round has C × N × (N−1) path observations; multiply by packet count and
   rounds for requested echo packets. Retain planned unavailable cells.

## Run and normalize

- Use one host target per source. A request's `source` and `vrf` apply to all its
  destinations; a group request cannot assign a different source to each host.
  Batch destinations within current limits and respect available diagnostic
  capacity. Omit `vrf` for the default context; set it explicitly for tenants.
  Respect permission denials; report denied tests without bypassing policy.
- Call `eos_ping` with `target`, `destinations`, `source`, and `count`, plus `vrf`
  for a tenant. Read per-destination `results[]`: `status` indicates execution,
  while `finding.reachability` indicates `reachable`, `partial`, or `unreachable`.
  Extract `packets_sent`, `packets_received`, `packet_loss_percent`, and nullable
  `rtt_ms.{min,avg,max}`. Preserve error codes for failed executions.
- Save each round immediately, keyed by context, source host/address, destination
  host/address, and round. Record request and collection times. Three packets per
  path are one round; three rounds repeat the full plan three times. Do not
  automatically retry loss or create extra rounds.
- Report planned, executed, failed-execution, unavailable, and reachable paths
  separately. Keep unavailable RTT null, not zero. When aggregating rounds, loss
  uses actual sent/received totals; aggregate average RTT weighted by replies and
  only when the required samples exist. Keep per-round results inspectable.

## HTML artifact

Default outputs: `.local-artifacts/reports/reachability-matrices.html` and a
sanitized `reachability-matrices.json` evidence file in the same directory. Honor
requested paths; preserve existing runs with timestamped filenames.

Use a dark navy header, light panels, clear typography, and generous spacing.
Arrange one directed heatmap per context with source rows, destination columns,
disabled diagonals, a loss/average-RTT selector, and a round selector if needed.
Use labeled legends, percent/ms units, and a common RTT scale across contexts.
Represent tool errors and unrun tests distinctly from 100% loss. Show an explicit
empty state when no matrix can be measured.

Selecting a cell reveals exact source, destination, VRF, counts, RTT, times, and
errors. Include coverage cards, a sortable/searchable detail table, and measured
high-RTT paths. Use a neutral status for unknowns and accessible labels alongside
color. Avoid treating small RTT differences as established performance faults.

Embed CSS, JS, SVG, and sanitized data in a single offline HTML file. Use system
fonts and no external requests. Escape device-derived text, render dynamic text
with `textContent`, and escape `<` as `\u003c` in embedded JSON. Provide keyboard
cell selection, responsive layout, printable tables, and expandable evidence.

Label underlay results as VTEP IP reachability. Tenant-context pings to unique
remote addresses test tenant reachability; observed VXLAN encapsulation requires
a separate correlated capture. A small cEOS sample is not an SLA or hardware
performance measurement. State collection scope, sample counts, and limitations.

## Verify and deliver

Reconcile cell counts and summary totals with saved observations; check that
missing RTTs never become zero. Validate inline JavaScript syntax. If a browser
is available, inspect heatmaps at wide/narrow widths and exercise cell, metric,
round, and table controls. Otherwise disclose the lack of visual verification.
Return clickable HTML/evidence links, coverage, and the main observed pattern.
Deliver a real report, including unknown cells if collection is incomplete.
