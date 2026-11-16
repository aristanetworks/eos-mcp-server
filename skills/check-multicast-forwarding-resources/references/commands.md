# Multicast forwarding-resource command matrix

Public documentary review: **2026-11-10**, rolling **EOS 4.37.0F User Manual**.
The references below support syntax and text interpretation. They do not
validate execution, a release/SKU support matrix, eAPI JSON keys, independent
ASIC readback, or receiver delivery. Verify applicability for the exact target
before operational use. Examples and numeric limits in the manual are not
universal platform capacities.

Use `eos_run_show` with `output_format: "text"`. Substitute square-bracket
placeholders with the established runtime tuple; keep one plain `show` command
per line, without pipes, redirects, chained commands, or manual `enable`.
Batch only commands applicable to the same eligible target set. Commands listed
here are choices for a bounded investigation, not an instruction to run all of
them. Reduce target/command scope if response limits are reached; retain the
incomplete check instead of treating truncated or failed output as complete.

## MRIB and MFIB

The [MRIB description](https://www.arista.com/en/um-eos/eos-multicast-architecture#xx1151266)
and [forwarding-plane description](https://www.arista.com/en/um-eos/eos-multicast-architecture#xx1151256)
separate routing intent from MFIB's preparation of hardware forwarding state.
Neither a software route nor its reported programming status proves delivery.

### Group-scoped MRIB, default VRF

```eos
show ip mroute [group]
```

[Public syntax](https://www.arista.com/en/um-eos/eos-multicast-architecture#xx1151794)
documents group-only selection. Select the source row locally; do not append a
source or invent VRF ordering from a different command family. Read complete
IIF/OIF lists and the output's own flag legend.

```eos
show ip mroute count
```

[Table statistics](https://www.arista.com/en/um-eos/eos-multicast-architecture#xx1151823)
are groups, sources, and routes. This is neither a packet counter nor measured
hardware IPMC occupancy. Use only when a table-size baseline is needed.

### Scoped MFIB and summary, default VRF

```eos
show multicast fib ipv4 [group] [source]
show multicast fib ipv4 summary
show multicast fib ipv4 [group] [source] counters
```

[Public MFIB syntax and examples](https://www.arista.com/en/um-eos/eos-multicast-architecture#xx1209301)
document group then source, the summary, and a per-flow `counters` example.
The summary separates multicast and fastdrop route counts; it is not a capacity
report. Preserve IIF/OIFs, route state and activity. The text guide states that
`N/A` means no associated counter; a group sum can be `N/A` when one source's
counter is unavailable, even while other sources have values.

### IPv4 route ingress counters, default or named VRF

```eos
show ip mfib [group] [source] counters
show ip mfib vrf [vrf] [group] [source] counters
```

[Public syntax and default-VRF example](https://www.arista.com/en/um-eos/eos-multicast-architecture#topic_icn_v3v_t4b)
cover these counter forms. They report route ingress packets/bytes, not
per-receiver or per-replica delivery. They do not establish all non-counter
MRIB/MFIB VRF selector combinations.

[Route-counter limitations](https://www.arista.com/en/um-eos/eos-multicast-architecture#concept_bm4_4f3_wnb)
exclude fastdrop routes and restrict PIM sparse-mode counting to `(S,G)` for
this IPv4 feature. The [counter feature reference](https://www.arista.com/en/um-eos/eos-multicast-architecture#xzx_ms2DZ9VkID)
states that it is disabled by default; inspect existing configuration only.
[Activity polling](https://www.arista.com/en/um-eos/eos-multicast-architecture#xzx_O0DJ2vMt_q)
uses hardware activity bits. Record the actual poll interval; a recent command
response does not mean its activity information was just refreshed.

## Resource allocation and capacity

```eos
show hardware resource l3 summary
```

[Public L3 resource summary](https://www.arista.com/en/um-eos/eos-ipv4#topic_isg_4px_chc)
contains IPv4/IPv6 `(*,G)`/`(S,G)` entries, multicast replication groups, Repl
head/list entries, and shared-resource indicators. Interpret only rows exposed
and applicable on the target. Preserve each denominator, unit and scope;
replication groups can include L2MC and L3MC. The section has platform-specific
field changes and inapplicability footnotes, including 7060X6 variants. Its
sample is not a guaranteed row set or capacity for 7050X3 or 7050X4.

```eos
show hardware capacity
```

[Public capacity view](https://www.arista.com/en/um-eos/eos-ipv4#xzx_isXDlAAM_z)
shows table, feature, chip, used entries/percentage, free entries, committed
entries, best-case maximum and high watermark where supplied. The sample is
ECMP; do not promise IPMC, replication or VXLAN multicast rows. Preserve the
resource's sharing semantics and avoid adding feature rows for the same pool.
A high watermark is historical; a best-case maximum is not a capacity guarantee.

## Trident partition allocation, conditional

```eos
show platform trident forwarding-table partition
show platform trident forwarding-table partition flexible
```

[Public partition reference](https://www.arista.com/en/um-eos/eos-ipv4#xx1148450)
documents L2, L3 and LPM sizes, and the `flexible` example includes
L2/L3/ALPM/ExactMatch banks with shared/dedicated status. These are allocation
observations, not proof of an effective Trident4 multicast profile or a
route-to-replication capacity ratio. Privileged EXEC is documented; if the
current read tool cannot obtain the view, report it unavailable without a shell
or manual-enable workaround.

## Trident hardware counters, conditional

```eos
show platform trident flexcounters summary
show platform trident flexcounters multicast summary
show platform trident flexcounters multicast values
```

[Public counter allocation and values](https://www.arista.com/en/um-eos/eos-multicast-architecture#xzx_KoFPM3LXnU)
distinguish feature allocation (`Mcast`, pool, counters), per-route assignment
(group/source/VRF, pool and base index), and raw values. The
[multicast counter resource discussion](https://www.arista.com/en/um-eos/eos-multicast-architecture#xzx_EkmQ5N7hMW)
explains finite, shared counter resources and priority-related reassignment.
This does not measure replication groups/head/list capacity.

Use the feature summary first. The other two forms expose per-route tables:
read only on applicable targets with a known manageable table and a justified
response budget. No scoped filter is established here. Retain an unavailable
assignment/value check when a broad dump would exceed the bounds. Preserve
counter identity and snapshot semantics; never clear a counter or change
priority/enablement to obtain a value.

## Deliberate coverage gaps

- No generic command here proves the active multicast/UFT profile on every
  SKU, especially Trident4. A configured profile and a bank-size view are
  separate evidence. Record effective-profile confirmation as unavailable
  unless an applicable operational source establishes it.
- No dedicated VXLAN multicast hardware-table command or X3/X4 equivalence is
  established by this matrix. Obtain tuple mapping through the EVPN multicast
  skill, then use applicable resource rows; retain any ASIC-table readback gap.
- `hwResourceFull` and `programmed` are not a validated JSON contract in these
  references. If present in supplied evidence, establish scope/provenance and
  correlate full OIF sets; do not assume the keys exist or imply delivery.
- IPv6 and unlisted VRF selector combinations require independent public
  syntax/support verification. Do not silently run the default-VRF IPv4 view
  for another family or VRF.
