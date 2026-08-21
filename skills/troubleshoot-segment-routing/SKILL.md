---
name: troubleshoot-segment-routing
description: >
  Troubleshoot ISIS Segment Routing issues on Arista EOS devices. Invoke when the user asks to troubleshoot, debug, fix, or investigate
  SR/segment-routing/ISIS-SR problems — e.g. "troubleshoot SR", "SR isn't working", "fix segment routing on PE1",
  "ISIS-SR is down", "SIDs are missing", "MPLS labels not programmed", "no SR tunnels", "TI-LFA not protecting".
  Runs validate-segment-routing first, then walks through structured troubleshooting steps.
allowed-tools: mcp__eos__eos_list_inventory, mcp__eos__eos_run_show
---

# Step 0: Run validate-segment-routing First

Before troubleshooting, invoke the `validate-segment-routing` skill to collect baseline ISIS-SR state. Analyze its output to identify which specific area is failing before proceeding.

# Step 1: Validate ISIS Global Config

Run `show running-config | section router isis` on the affected device(s).

Check:
- ISIS instance name matches across all devices in the topology
- Correct `is-type` (level-1, level-2, or level-1-2) is set
- NET address (`net 49.xxxx.xxxx.xxxx.xxxx.00`) is valid — system ID must be unique per device
- `segment-routing mpls` block exists with `no shutdown`
- `mpls ip` is enabled globally (required for LFIB entries)
- Address family (`address-family ipv4 unicast`) is configured

# Step 2: Validate ISIS Interface Config

Run `show running-config | section isis` to capture interface-level config.

Check:
- `isis enable <instance-name>` is present on each expected interface
- `isis network point-to-point` is set on P2P links (required for adjacency SIDs and TI-LFA)
- `isis circuit-type` matches the topology design (level-1, level-2, etc.)
- `isis metric` values are consistent with design intent
- `node-segment ipv4 index <N>` is configured on loopback interfaces with /32 addresses

Example of correct interface config:
```
interface Ethernet1
   isis enable CORE
   isis circuit-type level-2
   isis metric 1000
   no isis hello padding
   isis network point-to-point
```

# Step 3: Validate Interface State

If ISIS config looks correct but no peering forms, run `show interfaces <intf>` on the affected interface.

Check:
- Interface is `up/up` (line protocol up)
- No excessive errors, CRC, or input/output drops
- MTU is sufficient (ISIS LSP max size defaults to 9000)

Also run `show isis interface <intf>` to verify:
- ISIS is active on the interface
- Hello interval and hold time are reasonable
- BFD state if configured

# Step 4: Validate ISIS Adjacency

If interfaces are up but adjacency isn't forming, run `show isis neighbors detail`.

Check:
- Neighbor system ID appears and state is `UP`
- If state is `INIT` — possible one-way adjacency; check both sides
- If no neighbor at all — check L1/L2 mismatch, authentication mismatch, or area address mismatch
- Authentication: if MD5 is configured, verify keys match on both ends

# Step 5: Validate Node SIDs

Run `show isis segment-routing prefix-segments` on each device.

Check:
- Each device's loopback /32 prefix has a Node SID with the `N` flag set
- SID indexes are unique across the domain — no two devices should use the same index for different prefixes
- All expected remote Node SIDs are present (if missing, the remote device may have SR disabled or adjacency is down)
- Self-originated entries are marked with `*`

# Step 6: Validate SRGB Consistency

Run `show mpls label range` on each device.

Check:
- SRGB range (`isis-sr`) is consistent across all devices in the domain (default: base 900000, size 65536)
- Mismatched SRGB ranges cause incorrect label computation between peers
- No overlap between `isis-sr` range and `dynamic` or `static mpls` ranges

# Step 7: Validate MPLS LFIB

Run `show mpls lfib route` to verify labels are programmed in the forwarding plane.

Check:
- An LFIB entry exists for each learned prefix segment (label = SRGB base + SID index)
- Next-hop and outgoing label are correct
- If LFIB is empty but prefix-segments show entries, the MPLS agent may not be running (`mpls ip` not configured)

# Step 8: Check for SID Conflicts

If the validate-segment-routing output shows `#` (duplicate prefix) or `+` (duplicate SID) markers, there are conflicts.

Conflict resolution rules (for reference):
- **Prefix+SID conflict** (same prefix, same SID from two systems) — higher system ID wins
- **Prefix conflict** (same prefix, different SIDs) — higher system ID wins; if same system, smaller SID wins
- **SID conflict** (same SID, different prefixes) — higher system ID wins; if same system, smaller prefix length wins

Run `show tech-support ribd | section "SR Book Keeper"` to see detailed conflict state.

# Step 9: Validate TI-LFA Protection (if applicable)

Run `show isis segment-routing tunnel` and `show isis ti-lfa path`.

Check:
- Protected tunnels exist for expected prefix segments
- If segments show `unprotected` — verify `isis fast-reroute ti-lfa mode node-protection` (or `link-protection`) is configured on interfaces
- Only P2P interfaces are eligible for TI-LFA protection
- Backup paths require non-ECMP segments

# Reporting

After completing troubleshooting, produce a report:

- **Problem summary** — what was reported vs. what was found
- **Root cause** — the specific misconfiguration or failure identified
- **Steps taken** — which commands were run and what they showed
- **Resolution** — what config change is needed (show the exact commands), or if the issue is external (link down, peer device, etc.)
- **Verification** — suggest which `validate-segment-routing` checks to re-run after the fix
