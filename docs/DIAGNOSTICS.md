# Non-configuring network diagnostics

`eos_ping` executes bounded ping commands **on EOS**, not on the MCP host. It never changes configuration. It generates network traffic and is not a passive read. Traceroute and packet capture are future tools, not implemented capabilities.

## Authorization and addressing

A **Target** is an inventory host or group executing the diagnostic. A **Destination** is a literal IPv4/IPv6 address being tested and need not appear in inventory. DNS names and inventory-reference shorthand are not accepted as destinations.

Diagnostic access defaults to denied. Opt in explicitly using inherited inventory variables:

```yaml
vars:
  ansible_network_os: eos
  ansible_user: diagnostics-user
  mcp_password_env: EOS_MCP_PASSWORD
  mcp_diagnostics_allowed: true
hosts:
  leaf1:
    ansible_host: 192.0.2.11
```

`mcp_read_allowed: false` also denies diagnostics, regardless of the opt-in. Every resolved host must be eligible and authorized; a mixed-permission group fails before any commands are dispatched. `eos_list_inventory` reports `diagnostics_allowed` per host. Group resolution deduplicates hosts and preserves the existing alphabetical result ordering.

Use EOS AAA to restrict the credential to the intended operational commands. Ping requires enable mode on the tested EOS version. There is no SSH, device-shell, or MCP-host-shell fallback. Explicit diagnostic opt-in authorizes probes to arbitrary supported destinations reachable from the selected routing context; it is not a destination allowlist. Use network policy/ACLs if additional destination restrictions are required.

Supported addresses are unicast IPv4/IPv6 literals, including loopback. Unspecified addresses, IPv4 0/8 and reserved/multicast ranges, limited broadcast, IPv6 multicast, and IPv6 link-local/scoped addresses are rejected. IPv4-mapped IPv6 cannot bypass IPv4 restrictions. A directed broadcast cannot reliably be identified from an address alone; no such detection is promised.

## Tool inputs

```json
{
  "target": "leaf1",
  "destination": "2001:db8::10",
  "count": 3,
  "vrf": "BLUE",
  "source": "2001:db8::11",
  "include_raw": false
}
```

- `target` and `destination` are required.
- `count` defaults to the configured `defaultPingCount`; callers cannot exceed `maxPingCount`.
- `vrf` is optional, a safe single identifier of up to 64 characters. Omission uses the EOS default routing context.
- `source` is an optional IP literal in the same address family as the destination. Source-interface selection is not supported.
- An invalid/unavailable VRF or source fails; it never falls back to another context.
- `include_raw` defaults to false and exposes original EOS text only when true, including unrecognized output returned as a device failure.
- Arbitrary CLI commands/options are not accepted. Pacing is explicitly fixed at one second; EOS packet `size` is fixed at 64. Flood/rapid modes, custom sizes, and DNS resolution are not exposed.

## Settings and defaults

Add an optional `diagnostics` mapping to the existing settings YAML. Every omitted field retains its default:

```yaml
diagnostics:
  defaultPingCount: 3
  maxPingCount: 10
  maxProbesPerRequest: 100
  deviceConcurrency: 5
  pingReplyTimeoutMs: 1000
  commandTimeoutMs: 30000
  httpTimeoutMs: 35000
  overallOperationTimeoutMs: 60000
```

| Setting | Meaning |
| --- | --- |
| `defaultPingCount` | Number of probes when the caller omits `count` |
| `maxPingCount` | Maximum probes per device |
| `maxProbesPerRequest` | Maximum resolved host count multiplied by requested probes |
| `deviceConcurrency` | Ledger-scoped diagnostic capacity, shared by active and uncertain executions across calls and preserved across server restarts |
| `pingReplyTimeoutMs` | EOS per-reply timeout; a positive multiple of 1000 ms |
| `commandTimeoutMs` | Conservative device execution budget; see lifecycle below |
| `httpTimeoutMs` | Per-device diagnostic eAPI HTTP timeout, separate from `readTimeoutMs` |
| `overallOperationTimeoutMs` | Whole diagnostic call deadline, including waiting for global capacity |

Optional `diagnostics.stateFile` selects the durable SQLite ledger; relative paths resolve beside the settings file. Otherwise, the server uses `$XDG_STATE_HOME/eos-mcp-server/<inventory-identity>/diagnostics.sqlite`, falling back to `~/.local/state` when `XDG_STATE_HOME` is absent or not absolute. The identity hashes the inventory's canonical filesystem path, so symlink aliases share the default ledger. Keep the inventory identity and ledger location stable across restarts. Changing/copying inventory paths or selecting another state file does not migrate prior reservations and must not be used to bypass them.

Existing `maxReadTargets` (default 50) and `maxResponseSizeBytes` (default 1,048,576) also apply. Diagnostic concurrency and timeouts are independent of the corresponding read settings. Effective diagnostic settings are reported by `eos_get_server_info` under `limits.diagnostics`.

Numeric settings must be finite positive integers. The default count cannot exceed the maximum count; the maximum count cannot exceed the aggregate probe budget. The command budget must cover:

```text
maxPingCount * (pingReplyTimeoutMs + 1000) + 1000 ms
```

The HTTP timeout must exceed the command budget by at least 1000 ms. Individual settings must fit the supported timer range (2,147,483,647 ms); there is no combined reservation-expiry timer. Unknown fields and contradictory settings fail config validation. Increasing count/reply-timeout ceilings may require increasing both command and HTTP budgets. The overall deadline may intentionally be shorter than device execution; that cancels the call, not necessarily the remote command.

## Execution and lifecycle

Each device receives one text-mode eAPI request containing `enable` followed by the generated ping command. The exact wire request ID is committed as `rpc_request_id` before dispatch. All eAPI responses, including read-tool responses, must use JSON-RPC 2.0, match the exact request ID, and contain exactly one `result` or `error` member. Missing/stale identity fails with `eapi_response_uncorrelated`; contradictory envelopes fail with `eapi_payload_invalid`. Neither is completion evidence, and an unrelated response is never exposed as the requested diagnostic's raw output. There are **no automatic ping retries**, including no JSON-to-text retry. Read-only auto fallback also requires a correlated error and uses a new ID for its subsequent request. Existing `eos_run_show` validation remains show-only.

On cEOS 4.34.3M, ping's `timeout` maps to a per-reply wait, not a whole-process deadline. The tool combines finite `repeat`, explicit one-second `interval`, and finite reply timeout; the conservative execution formula above must fit `commandTimeoutMs`. This budget is **not** a remote wall-clock kill timer. It assumes normal EOS command scheduling, not a stalled operating system or an indefinitely queued eAPI command. No remote process termination guarantee is made.

One admission controller is shared by all diagnostic calls using the server's ledger. The reservation is durably committed **before** the device runner can dispatch. Confirmed synchronous completion or a locally established rejection before dispatch releases capacity only after the removal commits. Unknown completion after transport loss, HTTP timeout, invalid eAPI payload (including correlated results with missing or non-text output), cancellation, or a post-dispatch RPC error becomes **uncertain and never expires automatically**. RPC interruption errors are not process-reaped certificates; even failed commands may conservatively retain capacity. Neither elapsed time nor HTTP abort proves that earlier work stopped or cannot start later. A late confirmed response can release its reservation only while the original owner still has the ledger open; there is no reset exposed through MCP.

The ledger uses Node's built-in SQLite (Node 24+, potentially marked experimental by the runtime), FULL synchronous commits, and a separate SQLite ownership database. Only one server may own a ledger; another owner fails with `diagnostic_state_in_use`. OS locking releases ownership when a process crashes, without PID-age guessing or deleting a stale lock. All unfinished records, including records persisted as active before a crash, reopen as uncertain. Corrupt, incompatible, inventory-mismatched, or half-missing state is rejected rather than initialized as fresh capacity. A full SQLite integrity check runs before restored capacity is accepted and during offline inspection; malformed indexes must not hide occupied reservations. State write failure blocks further diagnostics with `diagnostic_state_write_failed`; an abort listener does not throw if writing uncertainty fails, because the earlier committed record still preserves the reservation.

The overall deadline or MCP cancellation stops scheduling new devices, removes capacity waiters, and aborts in-flight HTTP work. An overall timeout is a request-level `operation_timeout`, not a partial-results response. Already completed findings are not returned on that path. Do not blindly retry an interrupted diagnostic.

## Uncertain execution and capacity visibility

`eos_get_server_info` returns a fresh `diagnostics.capacity` snapshot with:

- `scope: "state-file"` for the production durable ledger, `limit`, and `available_count`. A deliberately in-memory executor reports `server-instance`; production can use that mode only when no inventory host has diagnostic permission.
- `active_count`, `uncertain_count`, and `queued_count`.
- `reservations`: ID, inventory hostname, diagnostic kind, state, reservation timestamp, and (when uncertain) uncertainty timestamp and machine-readable reason code. New reservations also carry `rpc_request_id`, matching the journaled reservation ID and the actual wire ID. Legacy records without this field remain uncorrelated; no wire identity is invented for them. Destinations, endpoints, credentials, and original EOS output are not included.
- `storage_error_code` when journal I/O has failed; new work is blocked even if the numeric limit would otherwise leave space.

When every slot is uncertain, new requests fail immediately with `diagnostic_capacity_uncertain`. The MCP result has `isError: true` and structured `error_code`/`message`. Work already waiting for capacity is also rejected instead of waiting indefinitely; if uncertainty arises during group execution, those failures use the existing per-device envelope. If some healthy capacity remains, it can still execute diagnostics without freeing uncertain slots.

The standalone `print-server-info` CLI has no live executor and reports `diagnostics.capacity: null`, not fabricated available capacity. Inspect the running MCP server for actual reservation state.

### Offline inspection and operator recovery

```bash
eos-mcp-server inspect-diagnostics --config eos-mcp-server.yml --json
# Or derive the default ledger from the same inventory identity:
eos-mcp-server inspect-diagnostics --inventory inventory.yml --json
```

Inspection opens existing state read-only, including while another server owns it; it does not resolve credentials, contact devices, take over ownership, create a missing ledger, or clear records. Integrity, schema, reservations, and audit are read in one transaction, so a concurrent commit cannot mix before/after release states. A competing writer may fail closed while this short read snapshot is held; inspect current state before retrying an administrative release. Inspection reports recorded state, not proof that remote work completed.

**Operational constraints:** use a persistent local filesystem that honors SQLite locking and sync, private owner-controlled state files (POSIX mode 0600), and an owner-controlled directory not writable by group/others. Network filesystems and ephemeral/container storage are not qualified durability mechanisms. Preserve the ledger, its `.lock.sqlite` ownership file, and any SQLite recovery files together. Do not delete, replace, copy, rotate, roll back, or change the ledger path to clear reservations. Loss of both ledger files cannot be distinguished locally from first initialization. Before upgrading from the earlier in-memory implementation, unresolved old executions require independent reconciliation; they cannot be recovered from a journal that did not yet exist.

Restarting with the same ledger retains uncertainty. Recovery is now available only as an **offline, audited Operator Release** backed by a **Fencing Attestation**. There is no MCP reset, release-all operation, native completion-token lookup, or automatic timeout-based release. Stopping the MCP process establishes local ownership transfer, not remote termination.

#### Operator release workflow

1. Stop the server owning this ledger and prevent diagnostic resubmission. The release command refuses a live ledger owner; it does not stop one.
2. Run `inspect-diagnostics --json` and retain the `inventory_identity`, exact selected reservation IDs, immutable host/admission timestamps, and recorded RPC IDs. Establish the original physical device and execution epoch from independent evidence/history, not just today's inventory mapping.
3. Independently verify that the fence terminates running work, invalidates **accepted queued** work, and prevents later dispatch/replay. A timeout, empty process list, quiet counters, or repeated observations are insufficient.
4. Prepare a private JSON attestation from [the deliberately invalid template](examples/diagnostic-release-evidence.template.json). Replace every placeholder with actual evidence. Change each assertion to true only after verification. Do not put credentials, raw packet contents, or EOS output in the file; use evidence references instead.
5. Release only the exact covered IDs, then inspect the audit:

```bash
# Prepare with private permissions; the template cannot authorize a release as-is.
umask 077
cp docs/examples/diagnostic-release-evidence.template.json ./evidence.json
# Human: complete the attestation from independently verified fencing evidence.
chmod 600 ./evidence.json

eos-mcp-server release-diagnostics --config eos-mcp-server.yml \
  --reservation-id '<exact-id>' --evidence-file ./evidence.json \
  --confirm-fenced --json
# Repeat --reservation-id only for other IDs covered by the same attestation.
eos-mcp-server inspect-diagnostics --config eos-mcp-server.yml --json
```

`--confirm-fenced`, an evidence file, and explicit unique IDs are mandatory. Evidence is private, owner-controlled UTF-8 JSON with unique keys, at most 65536 bytes and 100 explicitly covered reservations. There is no wildcard selection. The command performs no credential resolution, device call, URI fetch, fencing action, or network retry. A state-only config with an explicit `diagnostics.stateFile` can be used if the original inventory is unavailable; the attestation still must match the ledger's stored inventory identity. If config declares an inventory path, its canonical identity must also match.

The attestation requires `evidence_version: 1`, a new UUID `attestation_id`, the exact `inventory_identity`, an accountable `verified_by`, a past UTC `verified_at`, a reason, and four literal-true assertions: `independent_evidence_verified`, `running_work_terminated`, `accepted_queued_work_cannot_execute`, and `replay_prevented`. Each covered reservation must match its exact ID, host and `reserved_at`, and its exact `rpc_request_id` (explicit JSON null for legacy records without one). It must also identify the physical device, fenced execution epoch, fencing time, and independent evidence reference. Fencing must follow reservation admission and precede verification. The selected CLI IDs and evidence scope must match exactly.

#### Audit and authority

The release audit and every selected deletion commit in **one FULL-synchronous SQLite transaction** under exclusive ledger ownership. A failed batch rolls back earlier deletions and its audit; unselected reservations remain held. The append-only-through-the-application audit records original reservation snapshots, the complete attestation, its canonical SHA-256 digest, an audit-content checksum, server recording time, and actual local OS username/UID. `verified_by` is a claimed accountable person, not authenticated identity; the OS account is collected independently. Local operators must be trusted and protected by OS access controls. This is not a cryptographic human-presence check, and an untrusted agent with the ledger owner's filesystem privileges is outside that protection.

`inspect-diagnostics --json` exposes `release_audit` to local operators; MCP server info does not expose the evidence or audit. Checksums detect accidental inconsistency, not deliberate tampering by the trusted filesystem owner. The program validates consistency and explicit authority; it **cannot establish the truth of external fencing evidence**. Releasing on false attestation can violate remote concurrency safety.

If CLI completion is lost, inspect the audit first. Repeating the exact committed attestation returns its original release ID with `already_committed: true` and makes no additional changes. Reusing an attestation UUID for changed evidence is rejected. This local administrative idempotency does not make EOS ping requests idempotent; never retry a ping just because its RPC ID is known.

Ledger schema 1 upgrades atomically to schema 2, preserving unresolved reservations and adding release history. Read-only inspection of schema 1 does not migrate it. A rejected release also rolls back any migration. Schema-2 ledgers with missing or invalid audit history fail closed, and older schema-1-only binaries must not be used to bypass the audit.

### Native EOS timeout qualification

The installed cEOS implementation exposes a `runCmds.requestTimeout` execution-stage interruption timer. It was accepted in a bounded read request, and a later loopback experiment observed an interruption response after 273 ms with a 250 ms native timer (RPC code 1001 / error 408). No ping process appeared in the subsequent samples. This single normal-load result does not qualify a dispatch-relative or process-exit deadline, nor establish the public support contract. The product does not enable it or treat timeout-shaped RPC errors as completion. No durable token-bound status/cancel method was qualified. See [the primary-source investigation](research/eos-diagnostic-lifecycle.md) for evidence, citations, and limits.

## Results

Results use the existing target metadata, `resolved_devices`, execution summary, and per-device result envelope. `request` echoes normalized intent, including the effective count. Per-device `finding` contains:

- `kind: "ping"`
- `reachability`: `reachable` (all replies), `partial` (some replies), or `unreachable` (no replies)
- `packets_sent`, `packets_received`, and calculated `packet_loss_percent`
- `rtt_ms: { min, avg, max }`, or null when unavailable

Execution `status: "success"` means ping executed and its output was understood. Zero replies are a successful execution with an `unreachable` finding, not a failed tool operation and not a diagnosis of the cause. Authentication/transport errors, invalid VRF/source, and malformed/inconsistent output are execution failures with machine-readable error codes. Unknown output never becomes an invented reachability or loss result.

## Extension seam

`DiagnosticExecutor.execute` accepts typed diagnostic intent and owns authorization, aggregate budgets, fan-out, fail-closed global admission, cancellation, result envelopes, and response limits. `getCapacity()` exposes a detached snapshot; server-info obtains it at call time rather than caching startup state. `DiagnosticDeviceRunner.execute` accepts inventory identity and prepared intent; the eAPI adapter owns connection resolution and a single command execution. Ping-specific validation, compilation, and interpretation remain in `src/diagnostics/ping.ts`.

The request, observation, and finding types are discriminated by `kind`; only `ping` is implemented. Add other real operations at this seam without exposing arbitrary command strings. Packet capture needs a separate decision about transport, privilege, visibility, asynchronous lifetime, artifacts, and sensitive data; no capture-session abstractions are fabricated now.

## Verification

Validated against the repository's cEOS 4.34.3M lab over HTTPS eAPI:

- IPv4/IPv6 loopback, explicit source and default VRF, and measured RTTs.
- Explicit one-second pacing, finite repeat count, and reply-timeout behavior.
- Group fan-out and 100% packet loss in the MGMT VRF.
- Invalid VRF and unavailable source fail without fallback.
- Overall HTTP cancellation can leave a short-lived device ping; observed processes exited after their finite probe sequence.
- MCP stdio execution loads configured defaults and returns real measurements.

Older EOS versions and physical platforms have not been qualified for this new tool; the existing read-path minimum does not establish ping compatibility.

```bash
npm test
npm run typecheck
npm run lint
npm run build
INTEGRATION=1 npm test
```

Integration tests use the isolated `clab/testlab.clab.yaml` lab (admin/admin and lab-only TLS override). The read-path suite now defaults to that topology's unprefixed node names; `EOS_MCP_TEST_PREFIX=clab-testlab-` supports older prefixed deployments. All 13 read-path checks have been run alongside the ping suites, including the EOS code-1003 unconverted-command JSON-to-text read fallback; active ping still never retries. Optional `EOS_PING_TEST_HOST`, `EOS_PING_TEST_HOST_2`, and `EOS_PING_TEST_SILENT_HOST` override its device/silent-destination addresses. Unit tests additionally cover partial loss, input injection, mapped-address restrictions, fail-closed policy, invalid settings, concurrent calls, uncertain reservations, cancellation, response-size enforcement, write-ahead ordering, blocked dispatch on storage failure, failed completion commits, private permissions, ownership exclusion, malformed/missing ledgers, actual child-process crash recovery, and offline non-mutating inspection. Operator-release tests use synthetic ledger records and synthetic attestations only: they cover exact scope, legacy null IDs, rejected/malformed evidence, private bounded file input, competing ownership, identity/timestamp mismatches, schema migration/rollback, partial deletion rollback, audit integrity and idempotent retry. They do not claim any real EOS execution was fenced or release live test reservations. Additional protocol regressions cover missing/stale IDs, invalid versions, contradictory result/error envelopes, no retry on an uncorrelated read error, persisted wire-ID ordering, and reservation survival across restart after an unrelated acknowledgement. The delayed-backend regression models a request timing out at 35 seconds and starting remotely after the former 65-second expiry: replacement work is now rejected, so modeled active execution stays within the configured ceiling. This is a deterministic fault model, not a claim to have reproduced live EOS queue overload. Live MCP integration also checks timeout-to-uncertain visibility and the structured capacity error before and after restarting with the same ledger.
