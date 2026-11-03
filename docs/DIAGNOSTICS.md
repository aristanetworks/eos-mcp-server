# Non-configuring network diagnostics

`eos_ping` executes bounded ping commands **on EOS**, not on the MCP host. It never changes configuration. It generates network traffic and is not a passive read. `eos_packet_capture` runs a bounded `tcpdump` on EOS and returns the packets it saw; see [Packet capture](#packet-capture). Traceroute is a future tool, not an implemented capability.

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

`mcp_read_allowed: false` also denies diagnostics, regardless of the opt-in. Every resolved host must be eligible and authorized; a mixed-permission group fails before any commands are dispatched. `eos_list_inventory` and `validate-inventory --json` report `diagnostics_allowed` per host. Group resolution deduplicates hosts and preserves the existing alphabetical result ordering.

Packet capture needs a further opt-in, `mcp_packet_capture_allowed`. It defaults to `false`, must resolve to boolean `true`, and is inherited like `mcp_diagnostics_allowed`. Permissions form a ladder, read ⊂ diagnostics ⊂ packet capture: a host is capture-allowed only when it is read-allowed, has `mcp_diagnostics_allowed: true`, and has `mcp_packet_capture_allowed: true`, so `mcp_read_allowed: false` or a missing diagnostic opt-in also denies capture. `eos_list_inventory` and `validate-inventory --json` report `packet_capture_allowed` per host. `eos_packet_capture` requires it on every resolved host.

```yaml
groups:
  capture_ok:
    hosts: [leaf1]
    vars:
      mcp_diagnostics_allowed: true
      mcp_packet_capture_allowed: true
```

Grant capture deliberately. A capture returns tcpdump's decoded summary of each packet, which can reveal cleartext secrets in the protocols it decodes, for example SNMPv1/v2c community strings. Anyone who can read the MCP results can see them.

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
  defaultCapturePacketCount: 10
  maxCapturePacketCount: 1000
  defaultCaptureWindowSeconds: 10
  maxCaptureWindowSeconds: 60
  maxCapturePacketsPerRequest: 2000
  captureDeviceConcurrency: 1
  captureOverallOperationTimeoutMs: 90000
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
| `nativeRequestTimeout` | Send EOS `runCmds.requestTimeout` set to `commandTimeoutMs`, so the device interrupts a ping that outlives its budget; set `false` for an EOS version that rejects the field. Packet captures always send it |
| `defaultCapturePacketCount` | Packets a capture waits for when the caller omits `packet_count` |
| `maxCapturePacketCount` | Maximum `packet_count`; at most 10000, the EOS limit |
| `defaultCaptureWindowSeconds` | Capture window when the caller omits `window_seconds` |
| `maxCaptureWindowSeconds` | Maximum `window_seconds` |
| `maxCapturePacketsPerRequest` | Maximum resolved host count × `packet_count` for one `eos_packet_capture` call |
| `captureDeviceConcurrency` | Of a host's diagnostic slots, those packet captures may hold across all calls, counting active and uncertain captures; must not exceed `deviceConcurrency` |
| `captureOverallOperationTimeoutMs` | Whole capture call deadline, including waiting for capacity; must exceed `maxCaptureWindowSeconds` |

Diagnostic capacity is held in memory by each server process; nothing is written to disk. Several MCP servers (for example two chat sessions) can run against the same inventory at once, each with its own `deviceConcurrency` and `maxConcurrentDiagnostics`. The former `diagnostics.stateFile` setting is rejected with guidance; delete it. Ledger files left under `$XDG_STATE_HOME/eos-mcp-server/` (or `~/.local/state/eos-mcp-server/`) by earlier versions are no longer read and can be deleted. See [ADR 0006](adr/0006-in-memory-timed-diagnostic-capacity.md).

Existing `maxReadTargets` (default 50) and `maxResponseSizeBytes` (default 1,048,576) also apply. Diagnostic concurrency and timeouts are independent of the corresponding read settings. Effective diagnostic settings are reported by `eos_get_server_info` under `limits.diagnostics`.

Numeric settings must be finite positive integers. The default count cannot exceed the maximum count; the maximum count cannot exceed the aggregate probe budget. The command budget must cover:

```text
maxPingCount * (pingReplyTimeoutMs + 1000) + 1000 ms
```

The HTTP timeout must exceed the command budget by at least 1000 ms. For capture, the default packet count cannot exceed the maximum, the maximum cannot exceed `maxCapturePacketsPerRequest` or 10000, the default window cannot exceed the maximum, `captureDeviceConcurrency` cannot exceed `deviceConcurrency`, and `captureOverallOperationTimeoutMs` must exceed `maxCaptureWindowSeconds`. Individual settings must fit the supported timer range (2,147,483,647 ms), and so must the timers a capture derives from `maxCaptureWindowSeconds`: the window plus 5 s for HTTP and plus 2 s for an uncertain hold, so the largest accepted window is 2,147,478 s. There is no combined reservation-expiry timer. Unknown fields and contradictory settings fail config validation. Increasing count/reply-timeout ceilings may require increasing both command and HTTP budgets. The overall deadline may intentionally be shorter than device execution; that cancels the call, not necessarily the remote command.

## Execution and lifecycle

Each host/destination execution is one text-mode eAPI request containing `enable` followed by the generated ping command. The reservation ID is used as the exact wire request ID. All eAPI responses, including read-tool responses, must use JSON-RPC 2.0, match the exact request ID, and contain exactly one `result` or `error` member. Missing/stale identity fails with `eapi_response_uncorrelated`; contradictory envelopes fail with `eapi_payload_invalid`. Neither is completion evidence, and an unrelated response is never exposed as the requested diagnostic's raw output. There are **no automatic ping retries**, including no JSON-to-text retry. Read-only auto fallback also requires a correlated error and uses a new ID for its subsequent request. Existing `eos_run_show` validation remains show-only.

On cEOS 4.34.3M, ping's `timeout` maps to a per-reply wait, not a whole-process deadline. The tool combines finite `repeat`, explicit one-second `interval`, and finite reply timeout; the conservative execution formula above must fit `commandTimeoutMs`. This budget is **not** a remote wall-clock kill timer. It assumes normal EOS command scheduling, not a stalled operating system or an indefinitely queued eAPI command. No remote process termination guarantee is made. The same budget is how long an uncertain slot is held (below).

One admission controller is shared by every eAPI request in a server process, reads and diagnostics alike ([ADR 0009](adr/0009-shared-per-device-eapi-slots.md)). It grants a diagnostic slot only while the device holds fewer than the top-level `deviceConcurrency` slots in total, fewer than `diagnostics.deviceConcurrency` diagnostic slots, and the process holds fewer than `maxConcurrentDiagnostics`; a packet capture also needs the device to hold fewer than `captureDeviceConcurrency` captures. Because the diagnostic share is below the device total, pings can never fill a device and hold up its reads. Waiters are served oldest first, skipping any that cannot run yet, so a ping waiting on a busy device never holds up a later one to a free device, and a capture waiting on a device's capture limit never holds up a ping or read to it ([ADR 0007](adr/0007-per-device-diagnostic-concurrency.md)). A slot is reserved **before** the device runner can dispatch. Confirmed synchronous completion or a locally established rejection before dispatch frees it immediately. Unknown completion after transport loss, HTTP timeout, invalid eAPI payload (including correlated results with missing or non-text output), cancellation, or a post-dispatch RPC error becomes **uncertain**: the slot stays held for that execution's own budget from that moment, then frees itself. For ping the budget is `commandTimeoutMs`; for a packet capture it is the capture's window plus 2 s. A late confirmed response frees it sooner. RPC interruption errors are not treated as proof of completion, with one exception: for a packet capture, EOS's time-limit error is its expected end and frees the slot at once (see [Packet capture](#packet-capture)). Restarting the server forgets uncertain slots; under normal scheduling the original command has finished within `commandTimeoutMs` of dispatch anyway. If EOS ever queued a request for longer than that, replacement work could overlap it; [ADR 0006](adr/0006-in-memory-timed-diagnostic-capacity.md) accepts that bounded risk for ping.

A request fans out into one execution per resolved host and destination. All of them queue with the same admission controller as every other call at once; each takes and releases its own reservation exactly as a single ping does. Different devices run in parallel, each up to `deviceConcurrency`, within `maxConcurrentDiagnostics` for the whole process. Queued executions wait for capacity inside the same overall deadline, so size requests so that roughly `ceil(destinations / deviceConcurrency)` successive waves of pings per host fit within `overallOperationTimeoutMs`. That estimate assumes the server ceiling has room: once hosts × destinations, plus the executions of other concurrent calls, exceed `maxConcurrentDiagnostics`, waves also wait on the ceiling. Uncertain reservations reduce both device and server capacity. On cEOS 4.34.3M eAPI ran at most three requests at once per device, pings and reads combined; further delivered requests, including show commands, waited on the device. The top-level `deviceConcurrency` default of 3 matches that, and the diagnostic default of 2 keeps one slot for reads. Set the top-level value to the device's own eAPI concurrency for other platforms.

The overall deadline or MCP cancellation stops scheduling new executions, removes capacity waiters, and aborts in-flight HTTP work. Every in-flight execution of a cancelled multi-destination request becomes uncertain, so one cancellation can hold up to `deviceConcurrency` slots on each targeted device for up to `commandTimeoutMs`; queued executions of that request are never dispatched. An overall timeout is a request-level `operation_timeout`, not a partial-results response. Already completed findings are not returned on that path. Do not blindly retry an interrupted diagnostic.

## Uncertain execution and capacity visibility

`eos_get_server_info` returns a fresh `diagnostics.capacity` snapshot for that server process with:

- `limit` (`maxConcurrentDiagnostics`), `device_limit` (`diagnostics.deviceConcurrency`), `eapi_device_limit` (top-level `deviceConcurrency`), `capture_device_limit` (`captureDeviceConcurrency`), and server-wide `available_count`.
- Server-wide `active_count`, `uncertain_count`, and `queued_count`.
- `devices`: for each inventory host holding or awaiting a slot, its diagnostic `available_count` (its diagnostic headroom, capped by its shared eAPI headroom and server-wide availability), `active_count`, `uncertain_count`, and `queued_count`, plus the read slots it holds and awaits (`read_active_count`, `read_queued_count`) and how many of its diagnostic slots are packet captures (`capture_active_count`, `capture_uncertain_count`, `capture_queued_count`).
- `reservations`: ID (also the wire RPC ID), inventory hostname, diagnostic kind, state, reservation timestamp, and (when uncertain) uncertainty timestamp, `releases_at`, and machine-readable reason code. Destinations, endpoints, credentials, and original EOS output are not included.

Uncertain slots count against their device's `deviceConcurrency` and against `maxConcurrentDiagnostics` like active ones. New work for that device queues behind them and is dispatched when a slot frees, within the overall deadline; if the deadline expires first the call fails with `operation_timeout`. Other devices keep running without waiting for them.

The standalone `print-server-info` CLI has no live executor and reports `diagnostics.capacity: null`, not fabricated available capacity. Inspect the running MCP server for actual reservation state.

### Native EOS timeout qualification

The installed cEOS implementation exposes a `runCmds.requestTimeout` execution-stage interruption timer. It was accepted in a bounded read request, and a later loopback experiment observed an interruption response after 273 ms with a 250 ms native timer (RPC code 1001 / error 408). No ping process appeared in the subsequent samples. This single normal-load result does not qualify a dispatch-relative or process-exit deadline, nor establish the public support contract.

Ping requests now send `requestTimeout` equal to `commandTimeoutMs` (in seconds) by default, so EOS also stops a command that outlives its budget. Re-checked on the cEOS 4.34.3M lab: a 4-probe loopback ping with a 30 s timeout completed normally in about 3.1 s; with 0.25 s EOS returned RPC 1001 / error 408 after 264 ms and no ping process remained on the device. The timer starts only when EOS begins executing the command, so it does not cover time a request spends queued before that. For ping, a timeout-shaped RPC error is still treated as unknown completion and holds the slot like any other uncertain execution. Packet captures always send `requestTimeout`, equal to their window, whatever `nativeRequestTimeout` says; see [Packet capture](#packet-capture). Other EOS versions and physical platforms have not been checked; if one rejects the field, every ping fails with an RPC error, and `diagnostics.nativeRequestTimeout: false` turns it off. No durable token-bound status/cancel method was qualified. See [the primary-source investigation](research/eos-diagnostic-lifecycle.md) for evidence, citations, and limits.

## Results

Results use the existing target metadata and envelope with one entry per host and destination, ordered by host and then by requested destination. `resolved_devices` lists hosts; `summary` counts host/destination executions, not devices. Each entry carries `inventory_hostname`, `resolved_endpoint`, `destination`, and `status`. `request` echoes normalized intent, including `destinations` and the effective count. Each successful entry's `finding` contains:

- `kind: "ping"`
- `reachability`: `reachable` (all replies), `partial` (some replies), or `unreachable` (no replies)
- `packets_sent`, `packets_received`, and calculated `packet_loss_percent`
- `rtt_ms: { min, avg, max }`, or null when unavailable

Execution `status: "success"` means ping executed and its output was understood. Zero replies are a successful execution with an `unreachable` finding, not a failed tool operation and not a diagnosis of the cause. Authentication/transport errors, invalid VRF/source, and malformed/inconsistent output are execution failures with machine-readable error codes, reported on that host/destination entry without failing the others. Unknown output never becomes an invented reachability or loss result.

## Packet capture

`eos_packet_capture` is a **Packet Capture**: it runs EOS `tcpdump` on one interface of every resolved host until `packet_count` packets have arrived, and returns them. It never configures mirroring, writes no files, and nothing outlives the call ([ADR 0010](adr/0010-bounded-synchronous-packet-capture.md)).

A capture sees only traffic sent or received by the device's control plane: routing protocols, BFD, management traffic, pings to or from the device. It never sees hardware-forwarded transit traffic, which would require mirroring configuration. On cEOS, front-panel ports are software interfaces, so lab results may differ from hardware.

### Inputs

```json
{
  "target": "leaf1",
  "interface": "Ethernet1",
  "filter": "tcp port 179 and host 10.0.0.2",
  "packet_count": 3,
  "window_seconds": 10
}
```

- `target` and `interface` are required. Every resolved host must have **Packet Capture Permission** (`packet_capture_allowed`); otherwise the whole request fails with `packet_capture_policy_denied` before anything is dispatched.
- `interface` is a full EOS name of type Ethernet, Management, Loopback, Port-Channel, Vlan, Tunnel or Vxlan, such as `Ethernet1`, `Ethernet1/1`, `Ethernet1/1/1`, `Ethernet1.100`, `Port-Channel10.100`, `Management0` or `Management1/1`, or the literal `any`. Abbreviations, `fabric` (EOS's default, whose view differs between cEOS and hardware) and `Cpu` are rejected with `packet_capture_interface_invalid`.
- `vrf` is optional and accepted only with `interface: "any"` (`packet_capture_vrf_requires_any`); it follows ping's VRF identifier rules (`diagnostic_vrf_invalid`).
- `filter` is an optional pcap-filter **Capture Filter** of up to 4096 characters without control characters (newline, carriage return, tab, NUL, DEL and the rest are rejected with `packet_capture_filter_invalid`). EOS hands it to tcpdump as one argument without a shell. EOS does not check pcap-filter syntax; see `packet_capture_filter_rejected` below.
- `packet_count` defaults to `defaultCapturePacketCount` and may not exceed `maxCapturePacketCount` (`packet_capture_count_invalid`); `window_seconds` defaults to `defaultCaptureWindowSeconds` and may not exceed `maxCaptureWindowSeconds` (`packet_capture_window_invalid`). Resolved hosts × `packet_count` may not exceed `maxCapturePacketsPerRequest` (`packet_capture_packet_limit_exceeded`). `maxProbesPerRequest` does not apply.
- There is no `include_raw`: the packets are the raw output.

Use a small `packet_count` (1 to 5) to answer "is this traffic arriving?", and a larger one only for busy flows. Without a filter, a capture on `Management0` or `any` includes the server's own eAPI traffic.

### Execution and lifecycle

Each host runs one text-mode eAPI request: `enable`, then

```text
tcpdump interface <INTERFACE> [vrf <VRF>] packet-count <N> [filter <FILTER>]
```

The filter is always last, because EOS reads it to the end of the line, so filter text can never add other keywords. The server never sends `file`, `size`, `max-file-size`, `filecount`, `monitor`, `queue-monitor`, `interface-address`, `verbose` or `lookup-names`. Every capture sends `runCmds.requestTimeout` equal to `window_seconds`, whatever `nativeRequestTimeout` says, so the device stops tcpdump at the end of the window even if the server has gone. The HTTP timeout is the window plus 5 s.

A capture takes a diagnostic slot from the same per-device eAPI slots as pings and reads, and a group target runs one capture per host concurrently. While running, a capture occupies one of the device's eAPI slots for up to its window. At most `captureDeviceConcurrency` (default 1) captures, active or uncertain, hold slots on one device at a time, so with default settings one capture, one ping and one read can run on a device together. A second capture to the same device, from the same call or another, queues until the first frees its slot, waiting within `captureOverallOperationTimeoutMs`; pings and reads to that device do not wait behind it, and captures to different devices run at once. A capture ends in one of two confirmed ways, each freeing the slot at once: EOS returns the packets once `packet_count` have arrived, or, at the end of the window, EOS returns a correlated RPC error 1001 in which `enable` succeeded and tcpdump's own result is "Command exceeded its allowed time limit" (error 408), which on cEOS 4.34.3M leaves no tcpdump process behind. Only that exact error counts; ping's handling of the same error is unchanged. If a capture's completion is uncertain (lost connection, HTTP timeout, cancellation, or any other post-dispatch RPC error), the slot is held for the window plus 2 s, since the device timer has ended the capture by then; ping keeps holding for `commandTimeoutMs`. The capacity snapshot lists such reservations with `diagnostic: "packet_capture"`. The whole call is bounded by `captureOverallOperationTimeoutMs`.

### Results

Results contain one entry per resolved host, without a `destination`. `request` echoes the interface, VRF, filter and effective `packet_count` and `window_seconds`. A successful entry's `finding` is a **Capture Finding**, complete when `packet_count` packets arrived within the window:

```json
{
  "kind": "packet_capture",
  "capture": "complete",
  "requested_packet_count": 3,
  "window_seconds": 10,
  "packets": [
    "22:06:07.386059 aa:c1:ab:ef:f8:0a > aa:c1:ab:eb:7a:d8, ethertype IPv4 (0x0800), length 114: 10.255.255.1 > 10.255.255.0: ICMP echo request, id 60673, seq 1, length 80"
  ]
}
```

`packets` holds tcpdump's lines verbatim, one per packet: numeric addresses, the link-layer header, and a timestamp without a date. The server does not parse protocols.

When the window ends first, the entry is still `status: "success"` and the finding is unfilled:

```json
{
  "kind": "packet_capture",
  "capture": "unfilled",
  "requested_packet_count": 3,
  "window_seconds": 10,
  "packets": []
}
```

Unfilled means fewer matching packets than requested arrived within the window, not that none arrived: the device discards a partial capture, so the packets that did arrive are lost. That is why a small `packet_count` suits "is X arriving?". An unfilled finding is not an execution failure; an invalid filter or a missing interface fails the entry instead.

EOS does not check pcap-filter syntax. When tcpdump rejects the filter, or cannot capture on the interface, it exits at once and its error goes to stderr, which eAPI drops, so EOS answers success with empty output. Because a capture that reaches its count always prints packets, and one that does not ends with the time-limit error, a successful response with empty or whitespace-only output can only mean tcpdump exited before capturing. That host's entry fails with `packet_capture_filter_rejected`, whose message names both likely causes; it is never reported as a complete or unfilled finding, so a malformed filter does not look like "no traffic". The command ran and exited, so its completion is confirmed and the slot is freed at once. (`packet_capture_filter_invalid` is the server's own check before dispatch.) There are no automatic retries. A host where the interface does not exist fails on its own entry (EOS returns an RPC error) without failing the others.

### Limitations

- An unfilled capture discards the packets that did arrive; EOS offers no way to keep them without writing a file. On hardware, it can also mean the traffic was forwarded in hardware rather than absent.
- tcpdump's own error text is lost with stderr, so `packet_capture_filter_rejected` cannot say whether the filter or the interface was at fault.
- Several captures on one device can run at once within `diagnostics.deviceConcurrency`; each holds an eAPI slot for up to its window.
- Default tcpdump decode can print cleartext secrets such as SNMPv1/v2c community strings; see the permission section above.
- Measured on cEOS 4.34.3M only.

## Extension seam

`DiagnosticExecutor.execute` accepts typed diagnostic intent and owns authorization, aggregate budgets, fan-out, fail-closed per-device and server-wide admission, cancellation, result envelopes, and response limits. `getCapacity()` exposes a detached snapshot; server-info obtains it at call time rather than caching startup state. `DiagnosticDeviceRunner.execute` accepts inventory identity and one prepared execution; the eAPI adapter owns connection resolution and a single command execution.

Each diagnostic kind supplies a `DiagnosticDefinition`: `permission` names the inventory permission every resolved host needs and the error code when one lacks it, `prepare` validates the whole request before dispatch and returns the echoed request plus the executions every resolved host performs, `budget` declares each execution's cost and the setting that bounds cost × resolved hosts, which the executor checks, `overallOperationTimeoutMs` gives the call deadline, `eapiExecution` gives each execution's EOS command, HTTP timeout and EOS request timer, `uncertainHoldMs` gives its uncertain hold, `resultIdentity` names the fields that tell a host's entries apart, and `interpret` turns an observation into a finding. An observation is either command output or, for a capture only, the runner's report that EOS's request timer ended it; the runner classifies device responses, and the definition decides what they mean. The executor runs every prepared execution on every host and knows nothing kind-specific. Ping's definition, validation, compilation, and interpretation live in `src/diagnostics/ping.ts`; it prepares one execution per destination and identifies each entry by `destination`. Multiple destinations are therefore a property of ping's definition, not of the executor. Packet capture's lives in `src/diagnostics/packetCapture.ts`; it prepares one execution per host, with no identity fields. The eAPI adapter sends each kind's `eapiExecution` plan; its only kind-specific rule is that EOS's time-limit error ends a capture normally but leaves a ping uncertain; shared validation such as the VRF check lives in `src/diagnostics/validation.ts`.

Admission queueing is separate from reservation state transitions; shutdown rejects queued work with `diagnostic_server_stopping`. The eAPI adapter separates connection validation from dispatch/error handling instead of maintaining a dispatch flag. `DiagnosticExecutionError` carries a typed `not_dispatched`, `completed`, or `unknown` classification; ordinary errors and malformed acknowledgements remain uncertain.

The request, observation, and finding types are discriminated by `kind`: `ping` and `packet_capture`. Add other real operations at this seam without exposing arbitrary command strings. A destination-based operation such as traceroute can reuse multi-destination fan-out by preparing one execution per destination, although its much longer execution bound makes large requests hard to fit in the overall deadline.

## Verification

Validated against the repository's cEOS 4.34.3M lab over HTTPS eAPI:

- IPv4/IPv6 loopback, explicit source and default VRF, and measured RTTs.
- Explicit one-second pacing, finite repeat count, and reply-timeout behavior.
- Group fan-out and 100% packet loss in the MGMT VRF.
- Multi-destination fan-out: six 10-packet pings from one host to its BGP peers completed in 18.6 s (about 56 s when issued as serial calls). A capacity sampler observed five simultaneous active reservations, and direct concurrent eAPI requests confirmed the device ran at most three commands at once.
- Invalid VRF and unavailable source fail without fallback.
- Overall HTTP cancellation can leave a short-lived device ping; observed processes exited after their finite probe sequence.
- MCP stdio execution loads configured defaults and returns real measurements.
- Packet capture: an `icmp` capture of 4 packets on node1-1 Ethernet1 while node2-1 pinged it returned exactly 4 echo lines (4.2 s for both calls, bounded by the 5-probe ping); a group capture on Ethernet6 succeeded on node1-1 (BFD traffic) and failed only node2-1's entry, which has no Ethernet6; an unfilled capture with a 2 s window was stopped by the device timer after about 2.04 s, returned an unfilled finding, and left no reservation behind; a capture with filter `notaproto foo` failed with `packet_capture_filter_rejected` after about 60 ms and left no reservation behind.

Older EOS versions and physical platforms have not been qualified for these tools; the existing read-path minimum does not establish ping or capture compatibility.

```bash
npm test
npm run typecheck
npm run lint
npm run build
INTEGRATION=1 npm test
```

Integration tests use the isolated `clab/testlab.clab.yaml` lab (admin/admin and lab-only TLS override). The read-path suite now defaults to that topology's unprefixed node names; `EOS_MCP_TEST_PREFIX=clab-testlab-` supports older prefixed deployments. All 13 read-path checks have been run alongside the ping suites, including the EOS code-1003 unconverted-command JSON-to-text read fallback; active ping still never retries. Optional `EOS_PING_TEST_HOST`, `EOS_PING_TEST_HOST_2`, and `EOS_PING_TEST_SILENT_HOST` override its device/silent-destination addresses. The capture suite grants capture permission in its own temporary inventory; `EOS_CAPTURE_TEST_HOST`, `EOS_CAPTURE_TEST_PEER`, and `EOS_CAPTURE_TEST_LINK_ADDRESS` override the capturing host, its directly connected neighbor, and the capturing host's address on that link. Unit tests additionally cover partial loss, input injection, mapped-address restrictions, fail-closed policy, invalid settings, concurrent calls, multi-destination ordering, concurrent destination dispatch, per-destination failure isolation, whole-request destination validation, multi-destination cancellation, uncertain reservations and their timed release, early release on a late confirmed response, cancellation, and response-size enforcement. Additional protocol regressions cover missing/stale IDs, invalid versions, contradictory result/error envelopes, and no retry on an uncorrelated read error. Live MCP integration checks timeout-to-uncertain visibility and runs a second server against the same inventory while the first holds an uncertain slot.
