# Platform hardware evidence

Use this branch for the IPv4 unicast flow already defined by the parent skill.
Keep the source/destination, direction, effective VLAN, matched prefix and VRF
fixed while correlating software and hardware evidence. All commands are reads
through `eos_run_show` with `output_format: "text"`. Replace square-bracket
operands with values established by preceding observations; never send them
literally. No counter enablement, collision-tracking enablement, SDK shell,
configuration change, packet injection or capture is part of this procedure.

## Platform profiles and restrictions

These profiles define the product scope of the investigation. They do not claim
that every command below is implemented on every SKU or EOS version. Command
syntax, family applicability, parser acceptance, platform-reported state and
fresh ASIC readback are separate validation layers.

Record the exact model, EOS release, forwarding card/slot, chip identity and
agent before choosing a hardware view. The public manual's chipset table has
multiple ASIC variants within a product series and multiple generations within
some chassis. A similar product name or a shared ASIC generation is not enough
to extend command coverage.

| Family/profile | Model/card restriction | Hardware evidence selection |
| --- | --- | --- |
| 7050X3 | Verify the exact SKU; the public table lists Trident3X5 and Trident3X7 variants | Identity/resources first; missing-MAC exception view only if its platform support and existing tracking are established; per-prefix L3 readback remains unqualified |
| 7050X4 | Verify the exact SKU/ASIC; the table explicitly identifies 7050DX4 as Trident4X11 and does not enumerate every X4 variant | Do not extrapolate one X4 SKU to the whole family; same conditional evidence selection as above |
| 7060X5 | Identify the exact SKU and reported forwarding ASIC; no full family ASIC map is established by the cited table | Identity/resources and existing counters where supported; no inherited Trident per-prefix or MAC recipe |
| 7060X6 | Identify the exact SKU and reported forwarding ASIC independently of X5 | Same evidence limits; do not infer command compatibility from the series number |
| 7280R3 | The table lists Jericho2, Jericho2C and more specific variants by SKU | FAP identity and conditional route/FEC correlation; establish hardware-VRF and chip scope |
| 7280R3A | Treat as a separate profile; do not derive its ASIC from the suffix or substitute R3 evidence | Discover the actual forwarding chip; route/FEC examples remain conditional on exact target applicability |
| 7300 | 7304/7308 with 7300X3-32C-LC, 7300X3-48YC4-LC or 7300X3-48TC4-LC forwarding cards, with Trident3 identity verified per card; exclude earlier-generation cards | Evaluate each eligible card separately; no blanket chassis or fabric-card coverage |
| 7289 | Verify exact system/card; the table's 7289 entry identifies Jericho2 | FAP identity and conditional route/FEC branch; no automatic inclusion of every later 7289 variant |
| 7500R3 | 7504N, 7508N or 7512N with identified Jericho2 forwarding cards; exclude older cards and chassis not mapped to Jericho2 by the cited table | Collect per-card/chip evidence; exclude older mixed-generation cards from this profile |
| 7800R3 | 7804-CH or 7808-CH with identified Jericho2 forwarding cards; distinguish forwarding chips from fabric chips; other chassis remain unqualified | Same per-card/chip restrictions; do not assume one returned FEC covers every chip |

The chipset table is an identity source, not a diagnostic-command compatibility
matrix. Unverified SKU/release support must be reported as such even for an
in-scope family. A chassis with a mixture of eligible and other cards needs
separate coverage records; one eligible card cannot qualify the whole chassis.

## 1. Identify the forwarding hardware and resource context

Reuse supplied facts or `eos_get_facts` for the exact model and EOS release. If
those facts are missing, use H00.

H00 — system model and software identity:

```eos
show version
```

Retain the complete model and software image version. Do not use a broad series
name as the device's identity.

H04 — installed module identity on modular systems:

```eos
show module
```

Retain slot, module role, exact card model and status. Associate these rows with
the chip inventory by slot; keep supervisors, fabric modules and forwarding
cards distinct. An absent/failed module read leaves card identity unresolved.

H01 — forwarding-chip identity:

```eos
show hardware system forwarding-chips
```

Retain slot, chip label/version/name and reported forwarding agent. Distinguish
forwarding chips from fabric-only chips. For modular systems, map the relevant
ingress and possible egress ports to forwarding cards/chips using existing,
verified topology or platform evidence. If that mapping is unavailable, leave
the required chip set unknown; a list of chips is not a port-to-chip map.
The manual labels H01 as Global Configuration but its example uses `switch#`.
Verify availability through the existing read access; do not enter configuration
mode or change access to make it work. Preserve an access failure as unavailable.

H02 — FAP identity, where applicable to the identified R-series hardware:

```eos
show platform fap
```

The documented view can identify FAP name, type, device and revision. It does
not prove a route, FEC or MAC entry exists. If unsupported, retain the failure;
do not guess another platform selector or infer the ASIC from a chassis suffix.

H05 — documented FAP interface-to-chip mapping example, where applicable:

```eos
show platform fap mapping interface Ethernet [port-number]
```

The public example substitutes `1` for `[port-number]`; use only a physical
Ethernet selector documented for the identified target/release. Retain chip
name, FAP ID, core and returned system/FAP/NIF port fields. Map the relevant
ingress and candidate egress interfaces separately. This is a port mapping,
not a packet-path observation. Breakout/modular selector grammar and complete
model coverage are not established by this example; retain unknown mappings
instead of inventing a selector. The example runs at a configuration prompt;
verify read-access availability without entering configuration mode.

H03 — resource context, when capacity is relevant to the discrepancy:

```eos
show hardware capacity
```

Read the returned table/feature/chip and resource fields as returned. High usage
or an allocation failure can support a resource hypothesis. Neither free space
nor a nonzero route total establishes that this flow's prefix, MAC or adjacency
is installed. Do not require every platform to expose identical resources.

## 2. Correlate reported hardware entries

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

## 3. Reuse already enabled route counters, when available

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

The X-series profiles have no publicly qualified per-prefix L3 readback recipe
in these references. Capacity, the RECMP FIB summary and DLB shadow state do not
fill that gap. Keep physical-path and receiver-delivery conclusions independent
from all hardware-state and counter observations.

## Public documentary evidence

Reviewed 2026-11-10 against the public **EOS 4.37.0F User Guide**. This is
documentary validation, not EOS execution, eAPI JSON-schema validation, a tested
release/SKU compatibility matrix or data-plane qualification. Use text fields;
no command-specific JSON keys are promised.

- [EOS User Manual](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf),
  section 10.1.20, Table 61, printed pages 1134–1138: chipset mapping by model
  and the FAP identity command. The table does not cover all newer variants.
- Same manual, sections 1.1.9.34 and 1.1.9.38, printed pages 76–77 and 81:
  installed modules and model/software identity.
- Same manual, section 11.1.10.23.2, printed pages 1359–1360: interface-to-FAP
  mapping example; its prompt and model/selector limits remain explicit.
- [7300X3 Data Sheet](https://www.arista.com/assets/data/pdf/Datasheets/7300X3-Datasheet.pdf),
  platform overview, technical specifications and ordering information: the
  three listed X3 line cards and 7304/7308 chassis. This does not establish
  diagnostic-command compatibility.
- Same EOS manual, section 11.1.11.57, printed page 1469: forwarding-chip discovery
  and its identity fields; section 16.4.5 provides a FAP identity output example.
- Same manual, section 14.1.14.84, printed page 2308: hardware-capacity fields.
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
