# Platform identity profiles

These profiles constrain model/card interpretation for the selected product
scope. They are not a hardware-command compatibility matrix. Record observed
identity separately from public table-derived identity. A shared chipset name
or a missing table entry cannot establish feature-command support.

| Family/profile | Model/card restriction and public identity limits |
| --- | --- |
| 7050X3 | Verify the exact SKU; the public table lists Trident3X5 and Trident3X7 variants among the CX3/SX3/TX3 models. Do not replace the exact model with the family name. |
| 7050X4 | Verify the exact SKU/ASIC; the table explicitly identifies 7050DX4 as Trident4X11 and does not enumerate every X4 variant. Do not extrapolate that mapping to all X4 models. |
| 7060X5 | Identify the exact SKU and observed forwarding ASIC. No complete family ASIC map is established by the cited table. |
| 7060X6 | Identify the exact SKU and observed forwarding ASIC independently of X5. The series number does not establish ASIC or command compatibility. |
| 7280R3 | The table lists Jericho2, Jericho2C and more specific variants by SKU. Preserve the returned identity and exact model. |
| 7280R3A | Treat as a separate profile. Do not derive its ASIC from a suffix or substitute R3 evidence; discover the actual forwarding chips. |
| 7300 | 7304/7308 with 7300X3-32C-LC, 7300X3-48YC4-LC or 7300X3-48TC4-LC forwarding cards, with Trident3 identity verified per card. Earlier-generation cards are outside this profile. |
| 7289 | Verify the exact system/card; the table's 7289 entry identifies Jericho2. It does not qualify every later 7289 variant. |
| 7500R3 | 7504N, 7508N or 7512N with identified Jericho2 forwarding cards. Exclude older cards and chassis not mapped to Jericho2 by the cited table; the chassis name alone is insufficient. |
| 7800R3 | 7804-CH or 7808-CH with identified Jericho2 forwarding cards. Distinguish forwarding from fabric chips; other chassis remain unqualified by these sources. |

The public table repeats 7304/7308 and some 7500 chassis with different ASIC
generations. Match actual installed cards and chip identities by slot. A mixed
chassis needs separate profile/coverage records; one eligible card cannot
qualify the whole chassis. An unqualified card remains in the output with its
identity and limitation, rather than disappearing from the inventory.

Do not derive an ingress/egress port map from this table. Use the discovery
procedure's relevant interface evidence and retain unknown mappings. Feature
skills must establish their own model/release applicability, selectors,
prerequisites and read semantics after consuming this identity record.

## Public sources

Reviewed 2026-11-10:

- [EOS 4.37.0F User Manual](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf),
  section 10.1.20, Table 61, printed pages 1134–1138. This is the QoS chipset
  mapping by model; it is an identity consistency source, not a general
  hardware-command support statement. It does not enumerate all newer variants
  or prove R3 card mappings from chassis entries alone.
- [7300X3 Data Sheet](https://www.arista.com/assets/data/pdf/Datasheets/7300X3-Datasheet.pdf),
  platform overview, technical specifications and ordering information: the
  three listed X3 line cards and the 7304/7308 chassis. Verify the actual
  installed chip identity; this sheet does not qualify diagnostic commands.
