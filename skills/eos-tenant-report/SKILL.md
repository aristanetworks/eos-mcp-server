---
name: eos-tenant-report
description: Generate an offline HTML investigation of EOS EVPN tenant routing, comparing route advertisements, VRF imports, VNI mappings, return routes, and source-pinned reachability. Use for visual tenant failure reports.
allowed-tools: Read, Write, Edit, Bash, mcp__eos__eos_get_server_info, mcp__eos__eos_list_inventory, mcp__eos__eos_run_show, mcp__eos__eos_get_running_config, mcp__eos__eos_ping
metadata:
  trigger: HTML tenant routing report, visual EVPN import investigation, VRF comparison report
---

# EOS tenant routing report

Investigate with EOS MCP and render an HTML report locally. Device configuration
stays unchanged; local tools are for artifacts and rendering, not alternate device
access. The skill is self-contained when installed individually.

## Resolve scope and endpoints

1. Read server limits and inventory permissions. Resolve the requested source
   device, comparison VRFs, and remote inventory devices from the user and
   workspace context. Ask for missing scope rather than inventing tenant intent.
2. Discover VRFs, unique diagnostic loopbacks/remote endpoints, VTEP source
   addresses, and L3 VNI mappings using `show vrf`, `show ip interface brief`,
   `show interfaces vxlan 1`, and `show vxlan vni`. Establish interface VRF
   membership with VRF-specific interface queries or focused config if necessary.
   Shared anycast gateway addresses are unsuitable as remote endpoint proof.
3. Build a comparison plan keyed by source device, VRF, remote device/address,
   remote prefix, and local source address. Record missing endpoints explicitly.
   Re-discover actual names/addresses; do not assume a particular lab's VRF names
   or loopback numbering. Prefer group calls for identical discovery commands.

## Trace the evidence chain

For each selected remote diagnostic prefix, collect enough evidence for these
stages, batching within current command/response limits:

| Stage | Evidence to obtain |
| --- | --- |
| Remote prefix originates | Remote VRF connected/local route and BGP redistribution/origination |
| EVPN advertisement | Remote EVPN route for the prefix and advertised-route evidence where supported |
| Local EVPN visibility | Source device's EVPN route, including extended communities/route targets |
| VRF import | Source device's tenant route and import targets compared with the remote export targets |
| Next-hop resolution | Remote VTEP reachability in the underlay plus Vxlan1/L3 VNI mapping |
| Return route | Remote VRF route back to the exact chosen source address |
| Reachability | Source-pinned ping in the selected VRF to the unique remote destination |

Useful command families:

```text
show bgp evpn summary
show bgp evpn route-type ip-prefix ipv4
show bgp neighbors <spine-address> evpn advertised-routes
show ip route vrf <vrf> <destination>
show ip route <remote-vtep>
show vxlan vni
```

Narrow prefix/detail queries to the device's supported EOS syntax. Where a route
advertisement is queried on the qualified cEOS image, put `neighbors <address>`
before `evpn`; `show bgp evpn neighbors ...` is unsupported there. Where a route
is carried as an EVPN MAC/IP route rather than an IP-prefix route, inspect that
route type instead. An unsupported command leaves the stage unknown; it does
not establish missing advertisement. A remote local BGP route alone does not
prove advertisement to a specific neighbor. Keep partial evidence useful if a
stage cannot be inspected.

Retrieve focused configuration through `eos_get_running_config` with an explicit
section, such as `router bgp`, to compare VRF import/export targets and relevant
origination policy. Redact password/key/community secrets before persisting
excerpts. Route-target extended communities used for EVPN import/export are
diagnostic evidence and should remain visible. Distinguish RD from RT, and L3
VNI from VLAN-backed L2 VNI; numerical similarity is not evidence of identity.

Inspect actual JSON before parsing: show results contain per-device
`command_results[]` with `command`/`output`. Tenant routes commonly live under
`vrfs.<vrf>.routes.<prefix>` with `vias[]` containing `vtepAddr`, `vni`, and
`localInterface`; underlay `vias[]` may use `nexthopAddr` and `interface`.

Run `eos_ping` with an inventory host target, literal destinations, explicit
tenant `vrf`, the discovered local `source`, and `count: 3` by default. Batch only
destinations sharing source and VRF within server limits. Respect permission
denials and preserve denied tests. Separate execution `status` from
`finding.reachability`, loss, and nullable RTT measurements.

An Established EVPN session proves neither advertisement nor import of a prefix.
An EVPN-visible route absent from a VRF warrants checking import policy; confirm
the relevant targets/policy before assigning a cause. A successful ping is tenant
reachability evidence; observed VXLAN encapsulation requires a correlated capture.

## HTML artifact

Default outputs: `.local-artifacts/reports/tenant-route-investigation.html` and
sanitized `tenant-route-investigation.json` beside it. Honor requested paths;
preserve previous runs with timestamped filenames. Save collection start/end,
exact request parameters, evidence per stage, errors, and derived findings.

Use a dark navy header, light panels, generous spacing, system fonts, and
text-labeled teal/amber/red status accents with a separate unknown state. Include:

- Side-by-side tenant panels displaying VRF name, relevant RTs, and L3 VNI.
- A tenant-by-remote-device grid for route presence and measured reachability.
- An inline SVG chain of advertisement → EVPN visibility → VRF import →
  next-hop resolution → ping, with a parallel return-route branch.
- Selectable stages opening evidence, redacted configuration comparisons, and
  sortable route/test details. Mark each stage observed, inconsistent, missing,
  or unknown, with its device/VRF attribution.
- Confirmed findings separate from hypotheses and a focused next check for each
  unresolved issue. Include an explicit empty state if collection is blocked.

Keep HTML offline and self-contained with embedded CSS/JS/SVG/data and no external
requests. Escape device text, use `textContent`, and encode `<` as `\u003c` in
embedded JSON. Provide labeled legends, keyboard controls, responsive layout,
print CSS, and expandable commands. Keep cEOS findings scoped to this environment.

## Verify and deliver

Check every diagram/grid state against saved evidence, RT/VNI labels against
observed data, and summary counts against the test plan. Validate inline JS
syntax. If a browser is available, inspect wide/narrow layouts and exercise
stage/grid selection; otherwise disclose unavailable visual verification.
Return clickable HTML/evidence links with confirmed findings and unresolved
stages. Completion requires generated artifacts, even if some checks are unknown.
