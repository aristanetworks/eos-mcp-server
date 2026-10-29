# Changelog

## Unreleased

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
