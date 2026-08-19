---
name: rfc-9721-validation
description: >
  Validate EVPN IP Mobility and Duplicate Address Detection per RFC 9721 on Arista EOS devices.
  Tests host MAC-IP moves across leafs, verifies IP mobility sequence number increments,
  and triggers duplicate host detection (host-flap / freeze) via rapid moves.
trigger: >
  When the user asks to test, validate, or verify: "IP mobility", "MAC mobility", "EVPN mobility",
  "RFC 9721", "host move", "host-flap", "duplicate address detection", "duplicate MAC",
  "duplicate IP", "EVPN DAD", "MAC-IP move", "host freeze", "test host move",
  "validate EVPN moves", or any question about testing host mobility or duplicate detection
  in an EVPN-VXLAN fabric.
skip: >
  General EVPN troubleshooting unrelated to mobility, BGP health checks (use check-bgp-health),
  non-Arista platforms, or configuration changes.
allowed-tools: mcp__eos__eos_list_inventory, mcp__eos__eos_run_show
---

# RFC 9721 — EVPN IP Mobility & Duplicate Address Detection Validation

Interactive, read-only test procedure that validates EVPN-IRB host mobility and duplicate
host detection on Arista EOS leaf switches. Uses the `eos` MCP server exclusively.
**Never modify device configuration.**

## Reference

- **RFC 9721** — Extended Mobility Procedures for EVPN-IRB
- Local copy: `/Users/sureshk/.claude/skills/rfc-9721-validation/rfc-9721.txt`
- Topology context: `/Users/sureshk/.claude/skills/rfc-9721-validation/topology.txt`

## Key RFC 9721 Concepts

1. **IP Mobility Sequence Number** — Every MAC-IP RT-2 route carries a sequence number
   via the MAC Mobility extended community. On a host move, the new leaf MUST advertise
   the route with a sequence number **higher** than the previous advertisement.

2. **Sequence Number Inheritance** — The MAC-IP route inherits its sequence number from
   the parent MAC route. All MAC-IP children of the same MAC share the parent's sequence
   number.

3. **Duplicate Host Detection** — If a host MAC or IP moves more than **N** times within
   **M** seconds (configurable), the host is marked as **duplicate** and the route is
   **frozen** (held down). This prevents flapping loops. On Arista EOS this is controlled
   by `host-flap detection` under `router bgp / address-family evpn`.

4. **Recovery** — A frozen host recovers either after the hold-down timer expires or
   via manual CLI intervention (`clear bgp evpn host-flap`).

---

## Procedure Overview

The test has **three phases**:

| Phase | Goal |
|-------|------|
| 1. Discovery & Baseline | Identify the host, leafs, VLAN, and capture pre-move state |
| 2. Single Move Test | Move the host once, verify IP mobility sequence number increments |
| 3. Duplicate Detection (Rapid Moves) | Move the host back and forth rapidly (5+ additional moves), verify host is flagged as duplicate / frozen |

---

## Phase 1 — Discovery & Baseline

### Step 1.1: Discover inventory

Call `mcp__eos__eos_list_inventory` to enumerate available devices.
Identify which devices are **leafs** (VTEPs) and which are **spines/RRs**.

### Step 1.2: Gather user inputs

Ask the user (use `AskUserQuestion` where possible):

1. **Host IP address** — The IP of the host being moved (e.g. `10.10.26.101`)
2. **VLAN** — The VLAN/subnet the host belongs to (e.g. `26`)
3. **Source leaf** — The leaf the host is currently connected to (e.g. `Leaf1`)
4. **Source interface** — The interface the host is connected on (e.g. `Ethernet1`)
5. **Destination leaf** — The leaf the host will be moved to (e.g. `Leaf2`)
6. **Destination interface** — The interface on the destination leaf (e.g. `Ethernet1`)

The user may not know all values — derive what you can from the device state.

### Step 1.3: Capture baseline state

Run these commands on **ALL leafs** in a single `mcp__eos__eos_run_show` call per leaf
(or as a group if all leafs share an inventory group):

```
show bgp evpn route-type mac-ip detail
show bgp evpn host-flap counters
show ip arp vlan <VLAN>
show mac address-table vlan <VLAN>
show vxlan address-table vlan <VLAN>
show bgp evpn instance
```

#### Extract and record from baseline:

| Data Point | Source Command | What to Record |
|------------|---------------|----------------|
| MAC-IP route for the host | `show bgp evpn route-type mac-ip detail` | Full route entry, **MAC Mobility sequence number**, originating VTEP, RD |
| Current ARP binding | `show ip arp vlan <VLAN>` | IP → MAC mapping on the source leaf |
| MAC table entry | `show mac address-table vlan <VLAN>` | MAC, type (dynamic/static), interface |
| VXLAN remote MACs | `show vxlan address-table vlan <VLAN>` | Remote MACs learned via VXLAN |
| Host-flap counters | `show bgp evpn host-flap counters` | Current move count for the host MAC/IP (may be 0) |
| Host-flap config | `show bgp evpn instance` | Detection threshold (N moves), window (M seconds), hold-down timer |

#### Baseline report format:

```markdown
## Phase 1 — Baseline State

**Host:** <IP> / <MAC>
**VLAN:** <VLAN>
**Source:** <leaf> / <interface>
**Destination:** <leaf> / <interface>

### EVPN MAC-IP Route (pre-move)
| Field | Value |
|-------|-------|
| RD | <rd> |
| MAC | <mac> |
| IP | <ip> |
| Next Hop (VTEP) | <vtep-ip> |
| Sequence Number | <N> |
| Route Status | <active/valid> |

### Host-Flap Detection Config
| Parameter | Value |
|-----------|-------|
| Threshold | <N> moves |
| Window | <M> seconds |
| Hold-down | <T> seconds |
| Current State | No flap detected / <count> moves |

### ARP & MAC Tables — <source-leaf>
| IP | MAC | Interface | Type |
|----|-----|-----------|------|
| <ip> | <mac> | <intf> | dynamic |
```

---

## Phase 2 — Single Move Test (IP Mobility Sequence Number)

### Step 2.1: Prompt user to move the host

Tell the user:

> **Action required:** Please move the host (<IP>) from **<source-leaf> / <source-intf>**
> to **<dest-leaf> / <dest-intf>** now.
>
> Once the host is connected to the new leaf and has sent at least one frame (ARP, ping, etc.),
> confirm the move is complete.

Wait for user confirmation before proceeding.

### Step 2.2: Wait and capture post-move state

After user confirms, wait ~5 seconds for EVPN convergence, then run on **ALL leafs**:

```
show bgp evpn route-type mac-ip detail
show bgp evpn host-flap counters
show ip arp vlan <VLAN>
show mac address-table vlan <VLAN>
show vxlan address-table vlan <VLAN>
```

### Step 2.3: Validate IP mobility

Compare pre-move and post-move state. Check **ALL** of the following:

| Check | Expected Result | Verdict |
|-------|----------------|---------|
| MAC-IP route next hop | Changed from source-leaf VTEP to dest-leaf VTEP | PASS/FAIL |
| Sequence number | Incremented (was N, now > N) | PASS/FAIL |
| ARP on dest leaf | Host IP → MAC learned locally | PASS/FAIL |
| ARP on source leaf | Host IP entry cleared or marked remote | PASS/FAIL |
| MAC table on dest leaf | MAC learned on local interface | PASS/FAIL |
| MAC table on source leaf | MAC cleared or learned via VXLAN (remote) | PASS/FAIL |
| Host-flap counter | Move count incremented by 1 (or shows 1 move) | PASS/FAIL |

#### Post-move report:

```markdown
## Phase 2 — Single Move Validation

### EVPN MAC-IP Route (post-move)
| Field | Pre-Move | Post-Move | Verdict |
|-------|----------|-----------|---------|
| Next Hop (VTEP) | <old-vtep> | <new-vtep> | PASS |
| Sequence Number | <N> | <N+1> | PASS |
| Originating Leaf | <source> | <dest> | PASS |

### Control Plane Convergence
| Check | Source Leaf | Dest Leaf | Verdict |
|-------|-----------|-----------|---------|
| ARP entry | cleared/remote | local | PASS |
| MAC entry | cleared/VXLAN | local (intf) | PASS |
| Host-flap moves | <count> | — | PASS |

**Phase 2 Result:** PASS — IP mobility sequence number incremented from <N> to <N+1>.
Host correctly moved from <source> to <dest>.
```

If sequence number did NOT increment, report **FAIL** and note this violates RFC 9721 Section 5.1
(Sequence Number Inheritance) and Section 6.1 (Local MAC-IP Learning).

---

## Phase 3 — Duplicate Address Detection (Rapid Moves)

### Step 3.1: Explain and prompt for rapid moves

Tell the user:

> **Duplicate Detection Test:** We will now trigger host-flap / duplicate address detection.
>
> Please move the host back and forth between **<source-leaf>** and **<dest-leaf>**
> rapidly — **5 more times**. Move the host, wait for a ping or ARP to complete,
> then move it back. Repeat until you've completed 5 additional moves.
>
> The goal is to exceed the host-flap detection threshold
> (<N> moves in <M> seconds) so the host gets flagged as duplicate.
>
> Confirm after each move, or confirm when all 5 moves are done.

### Step 3.2: Capture state after each move (or after all moves)

There are two modes depending on user preference:

**Option A — After each move:** After each user confirmation, run on all leafs:
```
show bgp evpn route-type mac-ip detail
show bgp evpn host-flap counters
```
Record the sequence number and move count incrementing with each move.

**Option B — After all moves complete:** Run the full command set once after the user
confirms all 5 moves are done.

### Step 3.3: Validate duplicate detection

After 5+ rapid moves (total of 6+ moves including Phase 2), run on **ALL leafs**:

```
show bgp evpn route-type mac-ip detail
show bgp evpn host-flap counters
show ip arp vlan <VLAN>
show mac address-table vlan <VLAN>
```

Check **ALL** of the following:

| Check | Expected Result | Verdict |
|-------|----------------|---------|
| Host-flap counter | Shows ≥ threshold (N) moves within window | PASS/FAIL |
| Host flagged as duplicate | `show bgp evpn host-flap counters` shows host as **Duplicate Detected** or **Frozen** | PASS/FAIL |
| Sequence number | Has incremented with each move (final seq > baseline + total moves) | PASS/FAIL |
| Route frozen | MAC-IP route may show hold-down / frozen state | PASS/FAIL |

#### Duplicate detection report:

```markdown
## Phase 3 — Duplicate Address Detection

### Move History
| Move # | Direction | Seq # After | Cumulative Moves | Timestamp |
|--------|-----------|-------------|-----------------|-----------|
| 1 (Phase 2) | src → dest | <N+1> | 1 | <time> |
| 2 | dest → src | <N+2> | 2 | <time> |
| 3 | src → dest | <N+3> | 3 | <time> |
| ... | ... | ... | ... | ... |
| 6 | dest → src | <N+6> | 6 | <time> |

### Duplicate Detection Result
| Check | Value | Verdict |
|-------|-------|---------|
| Total moves detected | <count> | — |
| Detection threshold | <N> moves in <M>s | — |
| Host flagged duplicate | Yes / No | PASS/FAIL |
| Route frozen | Yes / No | PASS/FAIL |
| Hold-down timer | <T> seconds remaining | — |

**Phase 3 Result:** PASS — Host correctly flagged as duplicate after <count> moves
within <M>-second window. Route is frozen per RFC 9721 Section 8.
```

If the host is NOT flagged as duplicate after exceeding the threshold, report **FAIL**
and note this violates RFC 9721 Section 8 (Duplicate Host Detection).

---

## Final Summary Report

After all phases, produce a consolidated report:

```markdown
# RFC 9721 Validation Report — EVPN IP Mobility & Duplicate Detection

**Date:** <date>
**Host Under Test:** <IP> / <MAC>
**VLAN:** <VLAN>
**Fabric Leafs:** <list of all leafs>

## Results

| Phase | Test | Result |
|-------|------|--------|
| 1 | Baseline captured | DONE |
| 2 | IP Mobility — Seq # increment on single move | PASS/FAIL |
| 2 | IP Mobility — ARP/MAC convergence | PASS/FAIL |
| 3 | Duplicate Detection — Host flagged after rapid moves | PASS/FAIL |
| 3 | Duplicate Detection — Route frozen | PASS/FAIL |

## RFC 9721 Compliance

| RFC Section | Requirement | Tested | Result |
|-------------|-------------|--------|--------|
| 5.1 | Sequence Number Inheritance — MAC-IP inherits from parent MAC | Yes | PASS/FAIL |
| 6.1 | Local MAC-IP Learning — seq# higher than remote | Yes | PASS/FAIL |
| 6.3 | Remote MAC-IP Update — old leaf probes and deletes stale entry | Yes | PASS/FAIL |
| 8.1/8.2 | Duplicate Detection — host frozen after N moves in M seconds | Yes | PASS/FAIL |

**Overall:** PASS / FAIL
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| No MAC-IP route found for the host IP | Ask user to verify the host is connected and has sent traffic (ping/ARP) |
| Sequence number is 0 and stays 0 after move | The move may not have been detected — ask user to generate traffic from the host |
| Host-flap counters not incrementing | Check `show bgp evpn instance` for host-flap detection config — it may be disabled |
| Host not flagged after rapid moves | Verify moves happened within the configured window (M seconds) — user may have been too slow |
| Command returns empty or error | The VLAN may not be configured on that leaf, or EVPN is not active — report and skip |

## Notes

- The topology may have **more than 2 leafs, 2 spines, or 2 RRs** — always discover
  the full inventory first and run validations on all relevant leafs.
- Spines and RRs are **not VTEPs** — do not run VXLAN or ARP/MAC commands on them.
  However, you may check BGP EVPN routes on RRs to verify route reflection.
- The host-flap detection threshold defaults vary by EOS version. Always read the
  actual config from `show bgp evpn instance` rather than assuming defaults.
- All commands are **read-only**. Never push configuration via this skill.
