# Forwarding-hardware discovery commands

Use `eos_run_show` with `output_format: "text"` and inventory targets. Reuse
existing facts where sufficient. Replace square-bracket operands before a call;
do not send placeholders, CLI pipes, shell modifiers or chained commands.
No command-specific eAPI JSON keys are qualified here.

## System and module identity

D01 — model and EOS identity, when supplied facts or `eos_get_facts` are insufficient:

```eos
show version
```

Retain the complete model, software image version and hardware revision when
returned. The public reference documents EXEC mode. A series name or an older
snapshot cannot replace the actual system/release context.

D02 — installed modules on a modular system:

```eos
show module
```

Retain slot, exact module model, type/description, revision and operational
status when returned. Keep line cards, fabric modules and supervisors distinct.
The public reference documents EXEC mode. Omit this read as not applicable only
when the identified system is fixed; a failed modular read is unavailable,
not evidence that no line cards are installed.

## Chip and FAP identity

D03 — chip inventory:

```eos
show hardware system forwarding-chips
```

Retain slot, chip label, chip version, chip name and forwarding agent. The
public example includes fabric ASICs as well as line-card switching ASICs.
Classify their roles from established slot/module/label evidence; keep unknown
roles explicit. A shared forwarding agent cannot distinguish every ASIC.

The manual labels this command Global Configuration but its example uses
`switch#`. Verify availability through existing read access; do not enter
configuration mode or change privileges to make it work. Preserve unsupported
syntax or an access failure, with its actual reason.

D04 — FAP identity, where applicable to the identified platform:

```eos
show platform fap
```

The public material provides FAP name, type, device and revision. It does not
establish universal model coverage or command-mode requirements. Use it as
identity corroboration, not proof that a route, MAC or FEC is programmed.
Do not substitute another platform selector if it is unsupported.

## Relevant interface mapping

D05 — the documented FAP interface-to-chip example:

```eos
show platform fap mapping interface Ethernet [port-number]
```

The public example substitutes `1` for `[port-number]`. Use only a physical
Ethernet selector documented for the exact target/release. Retain chip name,
FAP ID, core and returned system/FAP/NIF port fields. Associate them with the
module/chip inventory only when the identity/namespace relationship is proved.
Map each relevant ingress and candidate egress interface separately.

The example does not establish complete model coverage or modular/breakout
selector grammar. Its prompt is a configuration prompt; verify availability
through existing read access without entering configuration mode. Unsupported
access, an unknown selector or ambiguous mapping leaves that interface's chip
scope unresolved. A mapping is not an observation of a packet's physical path.

## Output and failures

Inspect the MCP operation's `results[]` by `inventory_hostname` and `status`.
Successful entries contain `command_results[]` with `command`, `output_format`
and `output`; with text format, `output` is the normalized CLI string. Failed
entries contain `error_code` and `message`, not an empty chip/module table.
These fields describe the MCP envelope, not EOS payload keys.

A command error can fail a device's batch without exposing usable partial
results. Split into smaller read batches if needed to isolate it. Keep failed
devices and expected interfaces in the result. For transport, permission or
response-size failures, record unavailable coverage; use only supported
narrowing, not guessed filters or a missing-field-as-zero assumption.

## Public documentary evidence

Reviewed 2026-11-10 in the public **EOS 4.37.0F User Guide**:

- [EOS User Manual](https://www.arista.com/assets/data/pdf/user-manual/EOS-User-Manual.pdf),
  sections 1.1.9.34 and 1.1.9.38, printed pages 76–77 and 81: module and
  system/software identity (D02 and D01).
- Same manual, section 11.1.11.57, printed page 1469: chip identity fields,
  fabric/line-card example and the command-mode conflict (D03).
- Same manual, sections 10.1.20 and 16.4.5: chipset/FAP identity recommendation
  and FAP output example (D04).
- Same manual, section 11.1.10.23.2, printed pages 1359–1360: interface-to-FAP
  mapping example (D05).

These are documentary forms and fields, not EOS execution, JSON-schema
validation or a tested release/SKU compatibility matrix. The PDF URL rolls
forward; retain the version used for each investigation and do not extrapolate
one accepted read to other models, releases or cards.
