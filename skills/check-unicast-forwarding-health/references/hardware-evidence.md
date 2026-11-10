# Platform hardware evidence

Use this branch for the IPv4 unicast flow already defined by the parent skill.
Keep the source/destination, direction, effective VLAN, matched prefix and VRF
fixed while correlating software and hardware evidence. All commands are reads
through `eos_run_show` with `output_format: "text"`. Replace square-bracket
operands with values established by preceding observations; never send them
literally. No counter enablement, collision-tracking enablement, SDK shell,
configuration change, packet injection or capture is part of this procedure.

## 1. Reuse the shared hardware identity and scope

Read [identify-eos-forwarding-hardware](../../identify-eos-forwarding-hardware/SKILL.md)
before choosing a platform view. Reuse its device/module/chip/interface evidence
for the same target, release and interval rather than recollecting it. Its
[platform profiles](../../identify-eos-forwarding-hardware/references/platform-profiles.md)
contain the model/card restrictions for the selected X-series, R-series and
modular extensions. A profile match alone does not qualify the commands below.

Keep unresolved identity, role, slot, interface mapping and chip coverage in
this flow's record. If the shared skill is unavailable, supplied identity
artifacts may provide the same evidence; otherwise leave the affected hardware
scope unqualified. Do not replace missing scope with a chassis name or ASIC
family assumption. A mixed chassis needs separate card/chip records.

## 2. Inspect resource context when relevant

H03 — resource context, when capacity is relevant to the discrepancy:

```eos
show hardware capacity
```

Read the returned table/feature/chip and resource fields as returned. High usage
or an allocation failure can support a resource hypothesis. Neither free space
nor a nonzero route total establishes that this flow's prefix, MAC or adjacency
is installed. Do not require every platform to expose identical resources.

## 3. Correlate reported hardware entries

The public sources below document the exact example forms, not a tested
per-SKU support matrix. Use a form only when its applicability to the identified
target is established by a matching public support reference or an explicitly
authorized observation on that exact model/release. Otherwise retain the
recipe as **unqualified for this target** and report per-entry hardware evidence
as unavailable. Do not turn identity/resource success into an implicit pass.

### Trident MAC programming exceptions

H10 — known MAC entries missing from hardware:

```eos
show platform trident l2 hardware mac-address-table missing
```

Use only on an applicable identified platform with existing failure-tracking
state. The manual places this command in the MAC learn-failure detection
procedure; this skill never enables the tracking feature. Without evidence
that the relevant diagnostic is active, its coverage is unknown.

Match the flow's MAC and effective local VLAN. Retain the returned software
presence, hardware presence and missing-chip fields. A matching missing entry
is a reported programming discrepancy on the named chip(s), subject to
the view's established coverage and data-source semantics. An empty exception
table, or the absence of the target MAC from it, does **not** prove that MAC is
installed on all required chips. This is not a general MAC lookup. Do not run it
on 7060 or another generation merely because a related platform uses the same
CLI word or ASIC vendor.

### Jericho route and FEC correlation

H20 — the documented prefix-bounded platform-route example:

```eos
show platform jericho ip route [matched-prefix]
```

Use the prefix selected by the software lookup, not an invented host route.
Retain hardware VRF ID, prefix, command/action, destination, VLAN/VID, Outlif,
MAC/CPU code, ECMP/FEC indices and tunnel information when returned. Read the
actual legend: the documented example includes an ECMP-divergence-across-chips
marker. A divergence needs chip-specific investigation; do not silently select
one row or automatically attribute it to this flow's loss.

The public example returns the same prefix in several hardware VRFs. This
command does not inherit the documented context-active-VRF rule of
`show ip route`. Establish the intended VRF-name-to-hardware-ID mapping from
verified evidence. Do not assume a software/kernel VRF ID is the same hardware
ID, or append an undocumented named-VRF selector. An ambiguous mapping leaves
the target route indeterminate.

H21 — the documented indexed FEC example:

```eos
show platform fap fec [fec-index]
```

Use only the FEC index identified by the matching route in the same hardware
context. Do not substitute an ECMP index, Outlif or another number appearing
in the route's destination field. Correlate the returned action, destination,
VID, Outlif, MAC/CPU code and tunnel rewrite with the expected local adjacency
or VXLAN egress, where available. A software ARP/FDB entry alone cannot fill a
missing hardware rewrite field.

Neither cited example establishes a VRF/chip selector grammar or proves that
the response is a fresh read of every ASIC. If card/FAP scope or lookup-index
namespace is unclear, do not guess selectors or reuse an index on another card.
Report **platform route/FEC state observed; hardware programming/readback and
chip coverage unproven**, with the missing scope. A software or agent shadow
backend cannot establish an ASIC entry, even if the CLI is platform-specific.
Do not replace a failed bounded lookup with an unfiltered whole-device route
dump.

## 4. Reuse already enabled route counters, when available

H30 — documented IPv4 route-counter view:

```eos
show route ipv4 counters
```

Use only when the matching route already has hardware counters enabled and the
command is supported on the identified target. The public manual documents
this full form in its prose and example; its abbreviated syntax line omits
the final token. Do not invent additional VRF/prefix/chip filters from that
abbreviation. The cited passage does not establish support on every profile.

Match the exact VRF name and prefix. Preserve packet and byte counts at two
times without clearing them. Verify unchanged route, device context, counter
configuration and reset continuity before subtracting; a decrease or missing
row invalidates a simple delta. Missing/disabled counters are **unavailable**,
not zero traffic. Do not enable counters: the manual warns that changing
hardware-counter configuration can affect transit traffic.

A positive delta supports activity on the counted route, which can aggregate
many flows. A zero delta does not identify a cause. Neither result identifies
the physical ECMP/LACP member, proves every ASIC is programmed, attributes a
drop to this packet, or establishes receiver delivery. Start with a narrow
target because this documented form can return many counter rows; if it exceeds
response limits, keep it unavailable rather than adding pipes or guessed filters.

## Report the limits explicitly

For each direction and relevant card/chip, report identity, exact model/release,
command support, source/time, software-to-hardware key mapping, observed entry
or discrepancy, unresolved adjacency/rewrite and chip coverage. Separate:

- **Identity/resource context observed** — no per-entry claim.
- **Platform route/FEC state observed** — a matching scoped platform entry;
  retain the reported action and unresolved data-source semantics.
- **Hardware programming observed** — only with established hardware-source
  semantics and matching keys/chips. Report a MAC exception as a discrepancy,
  not positive installation evidence.
- **ASIC readback verified** — only with established fresh-read semantics and
  the required matching entries/chips. The public examples here alone do not
  establish this level.
- **Existing hardware-counter activity observed** — not a unique-flow measure.
- **Unavailable/unsupported/indeterminate/not applicable** — with the reason;
  preserve these states in the result, even when another hardware read succeeds.

The shared X-series profiles have no publicly qualified per-prefix L3
readback recipe in these references. Capacity, the RECMP FIB summary and DLB
shadow state do not fill that gap. Keep physical-path and receiver-delivery conclusions independent
from all hardware-state and counter observations.

## Public documentary evidence

Reviewed 2026-11-10 against the public **EOS 4.37.0F User Guide**. This is
documentary validation, not EOS execution, eAPI JSON-schema validation, a tested
release/SKU compatibility matrix or data-plane qualification. Use text fields;
no command-specific JSON keys are promised.

- [EOS User Manual](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf),
  section 14.1.14.84, printed page 2308: hardware-capacity fields.
- Same manual, section 4.4.2, printed pages 287–288: MAC learn-failure diagnostic
  context and missing-hardware-entry output.
- Same manual, section 19.16, printed page 4413: prefix-bounded Jericho route
  example with multiple hardware VRFs and FEC/ECMP information.
- Same manual, section 20.6.2, printed page 4539: indexed FAP FEC example.
- Same manual, sections 11.1.10.23 and 11.1.11.88, printed pages 1357–1359 and
  1512: hardware-counter prerequisites and IPv4 route-counter example.

The URL is a rolling publication. Retain its displayed version/date in the
investigation; a later manual or one SKU's result does not validate another
release, SKU or forwarding card.
