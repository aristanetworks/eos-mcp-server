# Non-configuring network diagnostics

`eos_ping` executes bounded ping commands **on EOS**, not on the MCP host. It never changes configuration. It generates network traffic and is not a passive read. Traceroute and packet capture are future tools, not implemented capabilities.

## Authorization and addressing

A **Target** is an inventory host or group executing the diagnostic. A **Destination** is a literal IPv4/IPv6 address being tested and need not appear in inventory. DNS names and inventory-reference shorthand are not accepted as destinations. One request may name several destinations; each is tested from every resolved host.

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
  "destinations": ["2001:db8::10", "2001:db8::20"],
  "count": 3,
  "vrf": "BLUE",
  "source": "2001:db8::11",
  "include_raw": false
}
```

- `target` and `destinations` are required. A single ping is a one-element `destinations` array.
- `destinations` holds 1 to `maxDestinationsPerRequest` unique addresses. Duplicates are detected by canonical address, so different IPv6 spellings of one address (such as `::1` and `0:0:0:0:0:0:0:1`) count as duplicates, while an IPv4 address and its IPv4-mapped IPv6 form are distinct destinations. Every destination is validated before anything is dispatched, so one invalid or duplicate entry rejects the whole request. The former single `destination` field is rejected with guidance rather than ignored.
- `count`, `vrf`, and `source` apply to every destination.
- `count` defaults to the configured `defaultPingCount`; callers cannot exceed `maxPingCount`.
- `vrf` is optional, a safe single identifier of up to 64 characters. Omission uses the EOS default routing context.
- `source` is an optional IP literal in the same address family as every destination; mixing IPv4 and IPv6 destinations therefore requires omitting `source`. Source-interface selection is not supported.
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
  maxDestinationsPerRequest: 16
  deviceConcurrency: 2
  maxConcurrentDiagnostics: 32
  pingReplyTimeoutMs: 1000
  commandTimeoutMs: 30000
  httpTimeoutMs: 35000
  overallOperationTimeoutMs: 60000
  nativeRequestTimeout: true
```

| Setting | Meaning |
| --- | --- |
| `defaultPingCount` | Number of probes when the caller omits `count` |
| `maxPingCount` | Maximum probes per device and destination |
| `maxProbesPerRequest` | Maximum resolved host count × destination count × requested probes |
| `maxDestinationsPerRequest` | Maximum destinations in one `eos_ping` call |
| `deviceConcurrency` | Diagnostic slots one inventory host may hold across all calls, counting active and uncertain executions; must not exceed `maxConcurrentDiagnostics` or the top-level `deviceConcurrency`, the host's eAPI slots shared with reads |
| `maxConcurrentDiagnostics` | Diagnostic slots of one server process across all devices and calls |
| `pingReplyTimeoutMs` | EOS per-reply timeout; a positive multiple of 1000 ms |
| `commandTimeoutMs` | Conservative device execution budget; see lifecycle below |
| `httpTimeoutMs` | Per-device diagnostic eAPI HTTP timeout, separate from `readTimeoutMs` |
| `overallOperationTimeoutMs` | Whole diagnostic call deadline, including waiting for per-device and server-wide capacity |
| `nativeRequestTimeout` | Send EOS `runCmds.requestTimeout` set to `commandTimeoutMs`, so the device interrupts a ping that outlives its budget; set `false` for an EOS version that rejects the field |

Diagnostic capacity is held in memory by each server process; nothing is written to disk. Several MCP servers (for example two chat sessions) can run against the same inventory at once, each with its own `deviceConcurrency` and `maxConcurrentDiagnostics`. The former `diagnostics.stateFile` setting is rejected with guidance; delete it. Ledger files left under `$XDG_STATE_HOME/eos-mcp-server/` (or `~/.local/state/eos-mcp-server/`) by earlier versions are no longer read and can be deleted. See [ADR 0006](adr/0006-in-memory-timed-diagnostic-capacity.md).

Existing `maxReadTargets` (default 50) and `maxResponseSizeBytes` (default 1,048,576) also apply. Diagnostic concurrency and timeouts are independent of the corresponding read settings. Effective diagnostic settings are reported by `eos_get_server_info` under `limits.diagnostics`.

Numeric settings must be finite positive integers. The default count cannot exceed the maximum count; the maximum count cannot exceed the aggregate probe budget. The command budget must cover:

```text
maxPingCount * (pingReplyTimeoutMs + 1000) + 1000 ms
```

The HTTP timeout must exceed the command budget by at least 1000 ms. Individual settings must fit the supported timer range (2,147,483,647 ms); there is no combined reservation-expiry timer. Unknown fields and contradictory settings fail config validation. Increasing count/reply-timeout ceilings may require increasing both command and HTTP budgets. The overall deadline may intentionally be shorter than device execution; that cancels the call, not necessarily the remote command.

## Execution and lifecycle

Each host/destination execution is one text-mode eAPI request containing `enable` followed by the generated ping command. The reservation ID is used as the exact wire request ID. All eAPI responses, including read-tool responses, must use JSON-RPC 2.0, match the exact request ID, and contain exactly one `result` or `error` member. Missing/stale identity fails with `eapi_response_uncorrelated`; contradictory envelopes fail with `eapi_payload_invalid`. Neither is completion evidence, and an unrelated response is never exposed as the requested diagnostic's raw output. There are **no automatic ping retries**, including no JSON-to-text retry. Read-only auto fallback also requires a correlated error and uses a new ID for its subsequent request. Existing `eos_run_show` validation remains show-only.

On cEOS 4.34.3M, ping's `timeout` maps to a per-reply wait, not a whole-process deadline. The tool combines finite `repeat`, explicit one-second `interval`, and finite reply timeout; the conservative execution formula above must fit `commandTimeoutMs`. This budget is **not** a remote wall-clock kill timer. It assumes normal EOS command scheduling, not a stalled operating system or an indefinitely queued eAPI command. No remote process termination guarantee is made. The same budget is how long an uncertain slot is held (below).

One admission controller is shared by every eAPI request in a server process, reads and diagnostics alike ([ADR 0009](adr/0009-shared-per-device-eapi-slots.md)). It grants a diagnostic slot only while the device holds fewer than the top-level `deviceConcurrency` slots in total, fewer than `diagnostics.deviceConcurrency` diagnostic slots, and the process holds fewer than `maxConcurrentDiagnostics`. Because the diagnostic share is below the device total, pings can never fill a device and hold up its reads. Waiters are served oldest first, skipping any that cannot run yet, so a ping waiting on a busy device never holds up a later one to a free device ([ADR 0007](adr/0007-per-device-diagnostic-concurrency.md)). A slot is reserved **before** the device runner can dispatch. Confirmed synchronous completion or a locally established rejection before dispatch frees it immediately. Unknown completion after transport loss, HTTP timeout, invalid eAPI payload (including correlated results with missing or non-text output), cancellation, or a post-dispatch RPC error becomes **uncertain**: the slot stays held for `commandTimeoutMs` from that moment, then frees itself. A late confirmed response frees it sooner. RPC interruption errors are not treated as proof of completion. Restarting the server forgets uncertain slots; under normal scheduling the original command has finished within `commandTimeoutMs` of dispatch anyway. If EOS ever queued a request for longer than that, replacement work could overlap it; [ADR 0006](adr/0006-in-memory-timed-diagnostic-capacity.md) accepts that bounded risk for ping.

A request fans out into one execution per resolved host and destination. All of them queue with the same admission controller as every other call at once; each takes and releases its own reservation exactly as a single ping does. Different devices run in parallel, each up to `deviceConcurrency`, within `maxConcurrentDiagnostics` for the whole process. Queued executions wait for capacity inside the same overall deadline, so size requests so that roughly `ceil(destinations / deviceConcurrency)` successive waves of pings per host fit within `overallOperationTimeoutMs`. That estimate assumes the server ceiling has room: once hosts × destinations, plus the executions of other concurrent calls, exceed `maxConcurrentDiagnostics`, waves also wait on the ceiling. Uncertain reservations reduce both device and server capacity. On cEOS 4.34.3M eAPI ran at most three requests at once per device, pings and reads combined; further delivered requests, including show commands, waited on the device. The top-level `deviceConcurrency` default of 3 matches that, and the diagnostic default of 2 keeps one slot for reads. Set the top-level value to the device's own eAPI concurrency for other platforms.

The overall deadline or MCP cancellation stops scheduling new executions, removes capacity waiters, and aborts in-flight HTTP work. Every in-flight execution of a cancelled multi-destination request becomes uncertain, so one cancellation can hold up to `deviceConcurrency` slots on each targeted device for up to `commandTimeoutMs`; queued executions of that request are never dispatched. An overall timeout is a request-level `operation_timeout`, not a partial-results response. Already completed findings are not returned on that path. Do not blindly retry an interrupted diagnostic.

## Uncertain execution and capacity visibility

`eos_get_server_info` returns a fresh `diagnostics.capacity` snapshot for that server process with:

- `limit` (`maxConcurrentDiagnostics`), `device_limit` (`diagnostics.deviceConcurrency`), `eapi_device_limit` (top-level `deviceConcurrency`), and server-wide `available_count`.
- Server-wide `active_count`, `uncertain_count`, and `queued_count`.
- `devices`: for each inventory host holding or awaiting a slot, its diagnostic `available_count` (its diagnostic headroom, capped by its shared eAPI headroom and server-wide availability), `active_count`, `uncertain_count`, and `queued_count`, plus the read slots it holds and awaits (`read_active_count`, `read_queued_count`).
- `reservations`: ID (also the wire RPC ID), inventory hostname, diagnostic kind, state, reservation timestamp, and (when uncertain) uncertainty timestamp, `releases_at`, and machine-readable reason code. Destinations, endpoints, credentials, and original EOS output are not included.

Uncertain slots count against their device's `deviceConcurrency` and against `maxConcurrentDiagnostics` like active ones. New work for that device queues behind them and is dispatched when a slot frees, within the overall deadline; if the deadline expires first the call fails with `operation_timeout`. Other devices keep running without waiting for them.

The standalone `print-server-info` CLI has no live executor and reports `diagnostics.capacity: null`, not fabricated available capacity. Inspect the running MCP server for actual reservation state.

### Native EOS timeout qualification

The installed cEOS implementation exposes a `runCmds.requestTimeout` execution-stage interruption timer. It was accepted in a bounded read request, and a later loopback experiment observed an interruption response after 273 ms with a 250 ms native timer (RPC code 1001 / error 408). No ping process appeared in the subsequent samples. This single normal-load result does not qualify a dispatch-relative or process-exit deadline, nor establish the public support contract.

Ping requests now send `requestTimeout` equal to `commandTimeoutMs` (in seconds) by default, so EOS also stops a command that outlives its budget. Re-checked on the cEOS 4.34.3M lab: a 4-probe loopback ping with a 30 s timeout completed normally in about 3.1 s; with 0.25 s EOS returned RPC 1001 / error 408 after 264 ms and no ping process remained on the device. The timer starts only when EOS begins executing the command, so it does not cover time a request spends queued before that. A timeout-shaped RPC error is still treated as unknown completion and holds the slot like any other uncertain execution. Other EOS versions and physical platforms have not been checked; if one rejects the field, every ping fails with an RPC error, and `diagnostics.nativeRequestTimeout: false` turns it off. No durable token-bound status/cancel method was qualified. See [the primary-source investigation](research/eos-diagnostic-lifecycle.md) for evidence, citations, and limits.

## Results

Results use the existing target metadata and envelope with one entry per host and destination, ordered by host and then by requested destination. `resolved_devices` lists hosts; `summary` counts host/destination executions, not devices. Each entry carries `inventory_hostname`, `resolved_endpoint`, `destination`, and `status`. `request` echoes normalized intent, including `destinations` and the effective count. Each successful entry's `finding` contains:

- `kind: "ping"`
- `reachability`: `reachable` (all replies), `partial` (some replies), or `unreachable` (no replies)
- `packets_sent`, `packets_received`, and calculated `packet_loss_percent`
- `rtt_ms: { min, avg, max }`, or null when unavailable

Execution `status: "success"` means ping executed and its output was understood. Zero replies are a successful execution with an `unreachable` finding, not a failed tool operation and not a diagnosis of the cause. Authentication/transport errors, invalid VRF/source, and malformed/inconsistent output are execution failures with machine-readable error codes, reported on that host/destination entry without failing the others. Unknown output never becomes an invented reachability or loss result.

## Extension seam

`DiagnosticExecutor.execute` accepts typed diagnostic intent and owns authorization, aggregate budgets, fan-out, fail-closed per-device and server-wide admission, cancellation, result envelopes, and response limits. `getCapacity()` exposes a detached snapshot; server-info obtains it at call time rather than caching startup state. `DiagnosticDeviceRunner.execute` accepts inventory identity and one prepared execution; the eAPI adapter owns connection resolution and a single command execution.

Each diagnostic kind supplies a `DiagnosticDefinition`: `prepare` validates the whole request before dispatch and returns the echoed request plus the executions every resolved host performs, `probeCount` prices one execution against the aggregate budget, and `interpret` turns observed output into a finding. The executor runs every prepared execution on every host and knows nothing kind-specific. Ping's definition, validation, compilation, and interpretation live in `src/diagnostics/ping.ts`; it prepares one execution per destination. Multiple destinations are therefore a property of ping's definition, not of the executor.

Admission queueing is separate from reservation state transitions; shutdown rejects queued work with `diagnostic_server_stopping`. The eAPI adapter separates connection validation from dispatch/error handling instead of maintaining a dispatch flag. `DiagnosticExecutionError` carries a typed `not_dispatched`, `completed`, or `unknown` classification; ordinary errors and malformed acknowledgements remain uncertain.

The request, observation, and finding types are discriminated by `kind`; only `ping` is implemented. Add other real operations at this seam without exposing arbitrary command strings. A destination-based operation such as traceroute can reuse multi-destination fan-out by preparing one execution per destination, although its much longer execution bound makes large requests hard to fit in the overall deadline. Packet capture needs a separate decision about transport, privilege, visibility, asynchronous lifetime, artifacts, and sensitive data; no capture-session abstractions are fabricated now.

## Verification

Validated against the repository's cEOS 4.34.3M lab over HTTPS eAPI:

- IPv4/IPv6 loopback, explicit source and default VRF, and measured RTTs.
- Explicit one-second pacing, finite repeat count, and reply-timeout behavior.
- Group fan-out and 100% packet loss in the MGMT VRF.
- Multi-destination fan-out: six 10-packet pings from one host to its BGP peers completed in 18.6 s (about 56 s when issued as serial calls). A capacity sampler observed five simultaneous active reservations, and direct concurrent eAPI requests confirmed the device ran at most three commands at once.
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

Integration tests use the isolated `clab/testlab.clab.yaml` lab (admin/admin and lab-only TLS override). The read-path suite now defaults to that topology's unprefixed node names; `EOS_MCP_TEST_PREFIX=clab-testlab-` supports older prefixed deployments. All 13 read-path checks have been run alongside the ping suites, including the EOS code-1003 unconverted-command JSON-to-text read fallback; active ping still never retries. Optional `EOS_PING_TEST_HOST`, `EOS_PING_TEST_HOST_2`, and `EOS_PING_TEST_SILENT_HOST` override its device/silent-destination addresses. Unit tests additionally cover partial loss, input injection, mapped-address restrictions, fail-closed policy, invalid settings, concurrent calls, multi-destination ordering, concurrent destination dispatch, per-destination failure isolation, whole-request destination validation, multi-destination cancellation, uncertain reservations and their timed release, early release on a late confirmed response, cancellation, and response-size enforcement. Additional protocol regressions cover missing/stale IDs, invalid versions, contradictory result/error envelopes, and no retry on an uncorrelated read error. Live MCP integration checks timeout-to-uncertain visibility and runs a second server against the same inventory while the first holds an uncertain slot.
