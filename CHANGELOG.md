# Changelog

## Unreleased

- Adds `eos_packet_capture`, a bounded **Packet Capture** of control-plane traffic on one interface of an inventory host or group. It requires `mcp_packet_capture_allowed` on every resolved host and runs one text-mode `tcpdump interface <INTF> [vrf <VRF>] packet-count <N> [filter <FILTER>]` per host, filter last, always sending EOS `requestTimeout` equal to the window. `interface` must be a full Ethernet, Management, Loopback, Port-Channel, Vlan, Tunnel or Vxlan name, or `any`; `vrf` is accepted only with `any`; `filter` is a pcap-filter expression of up to 4096 characters without control characters. Each host's finding is `complete` with tcpdump's lines verbatim in `packets`. Captures see only traffic sent or received by the device's control plane. New `diagnostics` settings, reported under `limits.diagnostics`: `defaultCapturePacketCount` (10), `maxCapturePacketCount` (1000), `defaultCaptureWindowSeconds` (10), `maxCaptureWindowSeconds` (60), `maxCapturePacketsPerRequest` (2000, hosts × packet count) and `captureOverallOperationTimeoutMs` (90000). The tool advertises `readOnlyHint: true` and `openWorldHint: false`. See [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md#packet-capture) and [ADR 0010](docs/adr/0010-bounded-synchronous-packet-capture.md).
- A packet capture that the device timer ends before `packet_count` packets arrive is now a successful entry with an unfilled **Capture Finding**, `capture: "unfilled"` with an empty `packets` array, and frees its slot at once. Unfilled means fewer matching packets than requested arrived within the window, not that none arrived; EOS discards a partial capture. Only a correlated RPC error 1001 whose command error is EOS's "Command exceeded its allowed time limit" is classified this way; any other post-dispatch error, HTTP timeout, transport loss or cancellation stays uncertain, and ping's handling of the same error is unchanged. No retries.
- A packet capture whose response is successful but empty, which is how EOS answers when tcpdump rejects the **Capture Filter** or cannot capture on the interface, now fails that host's entry with `packet_capture_filter_rejected` instead of `diagnostic_output_unrecognized`, and frees its slot at once. The message names both likely causes. It is never reported as a complete or unfilled finding, so a malformed filter does not look like "no traffic". EOS does not check pcap-filter syntax itself; `packet_capture_filter_invalid` remains the server's check before dispatch.
- An uncertain diagnostic slot is now held for that execution's own budget: `commandTimeoutMs` for ping, as before, and the window plus 2 s for a packet capture.
- Adds **Packet Capture Permission**: the inventory variable `mcp_packet_capture_allowed`, denied by default and inherited like `mcp_diagnostics_allowed`. A host is capture-allowed only when it is read-allowed, diagnostics-allowed and opted in, so read denial or a missing diagnostic opt-in also denies capture. Non-boolean values fail validation. `eos_list_inventory` reports `packet_capture_allowed` per host, and `validate-inventory --json` now includes `hosts` with each host's `read_allowed`, `diagnostics_allowed` and `packet_capture_allowed`. Captures can reveal cleartext secrets in decoded protocols, such as SNMPv1/v2c community strings; see [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) and [ADR 0010](docs/adr/0010-bounded-synchronous-packet-capture.md).

## 0.9.0-beta

- **Breaking:** `diagnostics.deviceConcurrency` now limits each device instead of the whole server process, and its default drops from 5 to 3, the measured cEOS 4.34.3M eAPI concurrency. The new `diagnostics.maxConcurrentDiagnostics` (default 32) caps the whole server; `deviceConcurrency` must not exceed it. Pings to different devices no longer queue behind one another, a ping waiting on a busy device no longer holds up one to a free device, and uncertain slots on one device no longer block others. A configuration that used `deviceConcurrency` to cap the whole server should also set `maxConcurrentDiagnostics`. The capacity snapshot adds `device_limit` and a per-host `devices` breakdown, and server info adds `limits.diagnostics.max_concurrent_diagnostics`. See [ADR 0007](docs/adr/0007-per-device-diagnostic-concurrency.md).
- Every tool now advertises MCP `readOnlyHint: true`, and `eos_ping` also `openWorldHint: true`, so clients such as Claude Code and Codex can run independent EOS calls concurrently. Previously Claude Code ran several pings or show commands issued together one at a time, and Codex needed `supports_parallel_tool_calls = true`, which the README's Codex examples no longer set. Some clients may also prompt less often before a ping; inventory diagnostic permission and server-side limits are unchanged. See [ADR 0008](docs/adr/0008-read-only-tool-annotations.md).
- **Breaking:** reads and diagnostics now share each device's eAPI slots across all calls. Top-level `deviceConcurrency` now limits the requests one device runs at once, reads and diagnostics together, and its default drops from 5 to 3, the measured cEOS 4.34.3M eAPI concurrency. Its old per-call role moves to the new `readFanOut` (default 10, hosts one read call contacts at once). `diagnostics.deviceConcurrency` drops from 3 to 2 and must not exceed the top-level value, so concurrent pings always leave a slot for show commands; on cEOS, three 10-packet pings could otherwise delay every read to that device for about 10 s, the default `readTimeoutMs`. `readTimeoutMs` now starts once a read's slot is granted. The capacity snapshot adds `eapi_device_limit` and per-host `read_active_count` and `read_queued_count`; server info adds `limits.read_fan_out`. A configuration that raised only `diagnostics.deviceConcurrency` must also raise the top-level value. See [ADR 0009](docs/adr/0009-shared-per-device-eapi-slots.md).

## 0.8.1-beta

- **Breaking:** removes the durable diagnostic ledger and its exclusive lock, so several MCP servers (for example two chat sessions, or the desktop app alongside Claude Code) can use the same inventory at once. Previously a second server failed to start whenever any host allowed diagnostics, losing every tool. See [ADR 0006](docs/adr/0006-in-memory-timed-diagnostic-capacity.md), which supersedes ADRs 0002 to 0004.
- When a ping's remote completion is unknown (timeout, cancellation, lost connection, malformed or uncorrelated response), its slot is now held for `diagnostics.commandTimeoutMs` and then freed automatically instead of indefinitely; a late confirmed response frees it sooner. New work queues behind held slots within the overall deadline. Server info reports `releases_at` for each uncertain reservation. `deviceConcurrency` now limits each server process rather than an inventory.
- Ping requests now send EOS's native `runCmds.requestTimeout`, set to `diagnostics.commandTimeoutMs`, so the switch itself interrupts a ping that outlives its budget. On by default; set `diagnostics.nativeRequestTimeout: false` if an EOS version rejects the field. Server info reports it as `limits.diagnostics.native_request_timeout`. Verified on cEOS 4.34.3M only.
- Removes the `inspect-diagnostics` and `release-diagnostics` commands, fencing attestations and release audit, the `diagnostics.stateFile` setting (now rejected with guidance), the `diagnostic_capacity_uncertain` and `diagnostic_state_*` errors, and the capacity snapshot's `scope`, `storage_error_code` and `rpc_request_id` fields (`reservation_id` is the wire RPC ID). Old ledger files under `~/.local/state/eos-mcp-server/` are no longer read and can be deleted.

## 0.8.0-beta

0.7.0-beta was not published to npm, so upgrading from 0.6.1-beta picks up both this section and the 0.7.0-beta section below.

- **Breaking:** `eos_ping` replaces `destination` with `destinations`, an array of 1 to `diagnostics.maxDestinationsPerRequest` (default 16) unique IP literals. Use `destinations: ["<ip>"]` for a single ping; the old field is rejected with guidance. Duplicates are compared by canonical address, so different IPv6 spellings of one address are rejected, while an IPv4 address and its IPv4-mapped IPv6 form stay distinct. Destinations run concurrently within the existing diagnostic concurrency, each with its own reservation. Results always contain one entry per host and destination, each carrying `destination`, and `summary` counts those entries rather than devices. All destinations are validated before dispatch, and `maxProbesPerRequest` now counts hosts × destinations × count. Server info reports `limits.diagnostics.max_destinations_per_request`. See [ADR 0005](docs/adr/0005-multi-destination-ping.md).
- Routes diagnostics through a per-kind `DiagnosticDefinition` (prepare, probe cost, interpret), so the executor no longer contains ping-specific logic.
- Documents the Codex `supports_parallel_tool_calls = true` opt-in in the README's Codex configuration examples. Without it, Codex runs independent EOS tool calls serially.
- Refreshes locked dependencies with `npm audit fix`, including `@modelcontextprotocol/sdk` 1.32.2 and its HTTP-transport dependencies. One advisory remains: zod's memory exhaustion when validating oversized constrained collections is fixed only in zod 4, which needs a separate migration.

## 0.7.0-beta

- Refactors diagnostic queueing and reservation transitions into separate paths, makes pre-/post-dispatch error handling explicit, and shares audit hashing and snapshot normalization. Ledger formats, schema versions, and safety policy are unchanged; adds coverage for queued journal failure without invalidating already-completed work.
- Retains uncertain diagnostic capacity for correlated malformed text results instead of mistaking validation failure for completion. Offline inspection now reads integrity, schema, reservations, and audit in one SQLite transaction, preventing mixed before/after release snapshots.
- Adds offline `release-diagnostics` with exact ID scope, a private bounded fencing-attestation file, explicit confirmation, exclusive ledger ownership, and atomic audit-plus-release. Records actual OS identity separately from the claimed verifier and checks content digests; it does not verify fencing truth or expose an MCP reset. Schema 1 migrates transactionally to schema 2, preserving unresolved work; `inspect-diagnostics` exposes read-only audit history. Exact committed retries are no-ops; changed attestation reuse is rejected.
- Validates JSON-RPC 2.0 response IDs and exclusive result/error envelopes before accepting output or retrying read-only JSON fallback. Missing/stale acknowledgements retain uncertain diagnostic capacity. New ledger reservations persist the exact wire RPC ID before dispatch; offline inspection distinguishes legacy records without one. IDs provide correlation, not an EOS status token or retry/deduplication guarantee.
- Adds `eos_ping`: bounded IPv4/IPv6 diagnostics executed on inventory hosts/groups, optional VRF/source IP, normalized loss/RTT and reachability findings, and opt-in original EOS text. Requires inherited `mcp_diagnostics_allowed: true`; read denial still vetoes execution. No configuration changes, automatic retries, or SSH/shell fallback.
- Fixes read-only auto output fallback for EOS code 1003 (`unconverted command`) and aligns optional read integration hostnames with the checked-in unprefixed topology. Ping's single-execution text path still never retries.
- Adds configurable `diagnostics` limits/timeouts with sensible defaults, ledger-scoped admission across simultaneous calls, and indefinite fail-closed reservations when device completion is unknown. Reports permission in inventory views, effective limits and live reservation state in server info, and a structured `diagnostic_capacity_uncertain` error when uncertainty exhausts capacity. Reservations are committed before dispatch to a private, inventory-keyed SQLite ledger and survive restart as uncertain. A crash-released ownership lock prevents competing owners; storage errors fail closed. Adds optional `diagnostics.stateFile` and offline, read-only `inspect-diagnostics`. Offline operator-attested release is available; a machine-verified native remote deadline/completion facility remains unresolved; post-dispatch RPC interruption errors do not prove completion. Qualified on cEOS 4.34.3M; traceroute and packet capture remain future work.
- Publishes the package to npm as `@aristanetworks/eos-mcp-server` (#14). The installed command is still `eos-mcp-server`. The release workflow publishes through npm trusted publishing, and prerelease tags go to the `next` dist-tag. The release tarball is now named `aristanetworks-eos-mcp-server-<version>.tgz`.
- Upgrading from a `.tgz` install: run `npm uninstall -g eos-mcp-server` before `npm install -g @aristanetworks/eos-mcp-server`. Both packages provide the same `eos-mcp-server` command.

## 0.6.1-beta

- eAPI requests now send `version: "latest"` instead of a hardcoded `version: 1`, so JSON output uses each command's current schema (#10). This changes JSON output from `eos_run_show`, `eos_get_facts`, and `eos_probe_devices`; text output is unaffected.
- Adds the `eapiVersion` config option (`latest` or `1`, default `latest`) to pin the original schema, and exposes it as `capabilities.eapi_version` in server info.

## 0.6.0-beta

- Refactoring EapiDeviceReader to hide connection information

## 0.5.3-beta

- Upgrades Node.js requirement to v24 LTS (Krypton).
- Updates GitHub Actions workflows to use Node 24/26.
- Refactoring how json/text outputs are handled.
- Removes configuration-changing scaffolding; the server is permanently read-only.

## 0.5.2-beta

- Refreshes the `qs` transitive dependency lock to clear the current `npm audit` finding.
- Adds fail-closed validation for known security-sensitive inventory variable types before effective policy evaluation.

## 0.5.1-beta

- Fixes `eos_run_show` being advertised with an empty input schema by moving its `command` XOR `commands` validation from a Zod `.superRefine()` into the tool handler; the wrapping `ZodEffects` was hiding `.shape` from the MCP SDK's schema normalizer, leaving callers unable to pass arguments.
- Adds a stdio smoke regression that asserts every tool with arguments advertises a non-empty `inputSchema.properties` containing `target`.
- Refactors logging request validation and EOS logging command construction into a dedicated Logging Query module.

## 0.5.0-beta

- Adds `eos_show_logging` for bounded, threshold-filtered EOS logging retrieval.
- Adds `maxLoggingMessagesPerRequest` config and exposes it through server info.
- Updates integration tests to resolve containerlab devices by hostname instead of ephemeral IPs.

## 0.4.0-beta

- Hardens eAPI response handling with invalid-JSON errors and runCmds result-count validation.
- Centralizes final read-tool response-size enforcement on the shared result envelope so tool-specific metadata is included in the limit check.
- Refactors inventory model construction into focused effective-vars, graph, and access-policy modules.
- Refactors MCP tool registration into shared tool definitions.
- Improves config file read failures with machine-readable `AppError` details.
- Sanitizes packaged example inventories and release documentation for public distribution.
- Refreshes transitive dependency locks to clear `npm audit` findings.
- Adds regression coverage for shared final-envelope response-size enforcement.

## 0.3.0-alpha

- Ships the Phase 1 read-only MCP server for Arista EOS eAPI.
- Adds read-only MCP tools for server info, inventory listing, probing, show commands, facts, and running-config retrieval.
- Adds strict inventory validation, fail-closed target resolution, startup connection validation, response-size limits, and read-operation timeout handling.
- Adds CLI commands for serving over stdio, validating inventory, printing server info, and probing targets.
