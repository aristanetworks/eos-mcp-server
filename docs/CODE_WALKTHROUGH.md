# Code Walkthrough

## Top Level

This repository is a single TypeScript/Node package.

- `src/` contains all source code.
- `test/` contains Vitest tests.
- `dist/` is generated build output from `tsc`.
- `docs/` contains project documentation (design, checkpoint, implementation plan, etc.).
- `Makefile` wraps build, lint/static policy checks, test, typecheck, clean, and packaging.
- `package.json` defines scripts: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. The package `prepack` hook runs `npm run build`.
- `scripts/static-policy.mjs` performs lightweight source policy checks for banned patterns such as plain `throw new Error`, `@ts-ignore`, `eslint-disable`, and `as any`.

## Runtime Entry

Execution starts at `src/index.ts`. It parses CLI args, loads config, then dispatches one of six commands:

- `serve`: load inventory, validate startup credentials, start MCP stdio server.
- `validate-inventory`: validate inventory and print the result.
- `print-server-info`: print sanitized server metadata.
- `probe`: run the same probe logic as the MCP probe tool.
- `inspect-diagnostics`: read existing reservations and release audit without device access, ownership takeover, or reset.
- `release-diagnostics`: offline, exact-scope operator release with explicit fencing attestation and atomic audit; no device calls or MCP exposure.

CLI parsing lives in `src/cli.ts`. The app name and version are read from `package.json` at runtime via `src/core/version.ts`. Shared error handling lives in `src/core/errors.ts`, which defines `AppError` and the stable machine-readable error codes used across the CLI and MCP layers.

## Config And Inventory

Config loading is in `src/config/loadConfig.ts`, with Zod schemas in `src/config/schema.ts`. Diagnostic defaults and cross-setting budget validation live in `src/config/diagnostics.ts`. It merges optional config-file values with CLI overrides and resolves paths.

`src/inventory/loadInventory.ts` orchestrates inventory loading. It supports simplified YAML and canonical Ansible-style YAML by delegating to a pipeline: parsing (`src/inventory/parse.ts`), schema detection and normalization (`src/inventory/normalize.ts`), structural and variable-type validation (`src/inventory/validateNormalized.ts`, `src/inventory/varValidation.ts`), and model construction (`src/inventory/buildModel.ts`). Together these validate structure, build effective host vars, resolve groups, and produce an `InventoryModel`.

Supporting inventory modules:

- `src/inventory/types.ts`: public inventory model types.
- `src/inventory/internalTypes.ts` / `src/inventory/internalUtils.ts`: shared types and helpers used across the parsing/normalization/validation pipeline.
- `src/inventory/effectiveVars.ts`: global/group/host variable inheritance and same-depth conflict handling.
- `src/inventory/graph.ts`: group parent maps, group depths, host lineage, direct memberships, and resolved group hosts.
- `src/inventory/policy.ts`: EOS eligibility and read access evaluation, including `mcp_read_allowed` and the explicit `mcp_diagnostics_allowed` opt-in (read denial vetoes both).
- `src/inventory/resolveTarget.ts`: host/group target resolution and policy fail-closed checks.
- `src/inventory/listInventoryView.ts`: sanitized inventory view for MCP output.

## Connection And eAPI

Connection resolution is in `src/connection/resolveConnection.ts`. It turns effective host vars plus server config into an eAPI connection: endpoint, username, password, TLS flags, CA file, timeout, eAPI output version, and response-size limit.

`src/connection/eosDeviceReader.ts` defines the host-oriented `EosDeviceReader` interface. Its `EapiDeviceReader` adapter owns per-host connection resolution and delegates command execution to the low-level eAPI runner.

Startup credential validation is in `src/connection/validateStartupConnections.ts`.

eAPI protocol and transport are split:

- `src/eapi/client.ts`: builds JSON-RPC `runCmds` requests using the connection's `eapiVersion` (`"latest"` by default, `1` when pinned in config), handles HTTP errors, invalid JSON, protocol version/response-ID correlation, exclusive result/error envelopes, JSON-RPC errors, and unexpected result counts. Supports opt-in enable mode (`{ enable: true }`) for privileged commands by prepending `enable` to the wire commands and stripping the extra result entry transparently. Per-request timeout and caller cancellation are combined with `AbortSignal`.
- `src/eapi/transport.ts`: production HTTPS transport and test-friendly fetch transport. The production transport enforces `maxResponseSizeBytes` while chunks are received, before buffering an oversized device response.
- `src/eapi/client.ts` also exposes single-execution text commands for active diagnostics, without JSON fallback retries, using the pre-journaled request identity supplied by the diagnostic execution context.
- `src/eapi/types.ts`: shared eAPI types, the low-level `EosCommandRunner` interface used by `EapiDeviceReader`, `EapiCommandOptions`, and helpers for validating/drilling into eAPI JSON-RPC response payloads.

## Read Tool Services

The core read behavior is implemented as service modules:

- `src/probe/probeDevices.ts`: runs `show version` to verify readiness.
- `src/eapi/commands.ts`: normalizes single-line EOS command inputs, rejects risky CLI modifiers/metacharacters, and validates `show` command boundaries.
- `src/show/runShow.ts`: validates strict `show` commands and runs them with `auto`, `json`, or `text` behavior.
- `src/logging/loggingQuery.ts`: validates Log Severity and message-count inputs, applies logging defaults/limits, and builds the EOS logging command.
- `src/logging/showLogging.ts`: executes the bounded Logging Query and returns unparsed log text.
- `src/facts/getFacts.ts`: collects fixed facts from `show version`.
- `src/configuration/getRunningConfig.ts`: returns running config text, requiring `section` for group targets. Uses enable mode since `show running-config` requires privileged access.

All device-facing read services accept an `EosDeviceReader` (defined in `src/connection/eosDeviceReader.ts`). They provide inventory hosts and command intent; the eAPI adapter resolves each host's connection before executing commands.

Shared read orchestration lives in `src/operations/readExecution.ts`. It centralizes target resolution, target limits, concurrency, overall timeout cancellation, common per-device result fields, result summaries (including the shared `DeviceResultSummary` type used by all result interfaces), final result-envelope response-size enforcement, and per-device `AppError.code` preservation.

Shared type-narrowing utilities (`isObject`, `readString`, `readBoolean`, `readNumber`, etc.) live in `src/utils/value.ts`.

## Diagnostic Execution

- `src/diagnostics/executor.ts`: typed diagnostic orchestration, inventory opt-in and probe-budget checks, existing result envelopes, and cancellation. One executor is created per server instance.
- `src/diagnostics/concurrency.ts`: admission shared by concurrent calls, with queueing separated from durable reservation creation, completion, and uncertainty transitions. Shutdown, storage failure, and exhausted uncertainty share queued-work rejection. Unknown completion never expires; cancelled waiters are removed.
- `src/diagnostics/eapiRunner.ts`: connection resolution followed by one text eAPI attempt in enable mode. Separate error paths distinguish local rejection before dispatch from uncertain RPC, transport, or malformed-result failures after dispatch; there is no mutable dispatch flag or retry.
- `src/diagnostics/executionError.ts`: typed `AppError` classification (`not_dispatched`, `completed`, or `unknown`). Only explicitly settled errors permit capacity reuse; ordinary errors remain uncertain.
- `src/diagnostics/ping.ts`: literal-address/VRF/source/count validation, finite ping command construction, and loss/RTT interpretation. A no-reply finding is not an execution failure.
- `src/diagnostics/types.ts`: request, prepared intent, observation, and finding types discriminated by diagnostic kind, plus the `DiagnosticDeviceRunner` seam. Only ping is implemented; capture sessions are not pre-modeled.

Diagnostic execution reuses read-operation orchestration with independent settings and global admission. Unknown completion retains capacity indefinitely; HTTP abort and elapsed budgets are not remote kill signals. Each server-info call reads `DiagnosticExecutor.getCapacity()` afresh; the standalone CLI reports no live snapshot.

`journal.ts` provides private SQLite persistence and an exclusive ownership lock; `statePath.ts` supplies canonical inventory identity/default storage. Entries survive crashes, and commit failure blocks dispatch or reuse. The journal is injected through `journalTypes.ts`, so pure executor tests can remain in memory. Native SQLite loads only when production diagnostic permissions or ledger administration require it.

`releaseEvidence.ts` validates attestation scope/consistency and uses shared JSON SHA-256 hashing for evidence and audit checksums; it does not verify external fencing. `reservationSchema.ts` validates and normalizes both unresolved records and audit snapshots, including absent legacy RPC IDs. The refactor preserves serialized records, checksum computation, and schema versions. Schema-1 migration, audit insertion, and selected deletions share the release transaction; ordinary server migration preserves occupied capacity. See [DIAGNOSTICS.md](DIAGNOSTICS.md).

## MCP Layer

The MCP server is assembled in `src/mcp/createServer.ts`. It creates the official SDK `McpServer`, registers eight non-configuring tools, and connects over stdio. Ping forwards the MCP cancellation signal into diagnostic execution.

Tool adapters live under `src/mcp/tools/`:

- `getServerInfo.ts`
- `listInventory.ts`
- `probeDevices.ts`
- `ping.ts`
- `runShow.ts`
- `showLogging.ts`
- `getFacts.ts`
- `getRunningConfig.ts`

These adapters define Zod input schemas, call the service layer, and return both text JSON and structured MCP content.

## Server Info And Commands

Server metadata is built by `src/serverInfo/buildServerInfo.ts`, with types in `src/serverInfo/types.ts`.

Local CLI commands live in `src/commands/`:

- `validateInventory.ts`
- `printServerInfo.ts`
- `probe.ts`
- `inspectDiagnostics.ts`
- `releaseDiagnostics.ts`

## Tests

Tests mirror the source layout:

- CLI and config: `cli.test.ts`, `loadConfig.test.ts`, `validateInventoryCommand.test.ts`
- Inventory and target behavior: `inventory.test.ts`, `targetResolution.test.ts`
- eAPI and connection behavior: `eapiClient.test.ts`, `eosDeviceReader.test.ts`, `startupValidation.test.ts`, `responseSize.test.ts`
- Read services and orchestration: `probeDevices.test.ts`, `runShow.test.ts`, `loggingQuery.test.ts`, `showLogging.test.ts`, `getFacts.test.ts`, `getRunningConfig.test.ts`, `readExecution.test.ts`
- Diagnostics: `ping.test.ts`, `diagnosticConfig.test.ts`, `diagnostics.test.ts`, `diagnosticEapi.test.ts`, `diagnosticReservations.test.ts` (delayed-start/cancellation regressions and visibility)
- Diagnostic persistence: `diagnosticJournal.test.ts` (including child-process crash/lock recovery), `diagnosticPersistence.test.ts` (write-ahead failures and queued-admission failure without invalidating completed work), `eapiCorrelation.test.ts`, `inspectDiagnostics.test.ts` (read-only CLI and concurrent-release snapshot consistency)
- Server info and errors: `buildServerInfo.test.ts`, `errors.test.ts`, `errorTaxonomy.test.ts`
- MCP adapters and stdio: `readToolsMcp.test.ts`, `probeDevicesTool.test.ts`, `listInventoryTool.test.ts`, `mcpStdioSmoke.test.ts`
- Package/static policy: `packagePolicy.test.ts`, `packageSmoke.test.ts`
- Optional cEOS integration (requires a configured lab): `integration.test.ts`, `pingIntegration.test.ts`, `pingMcpIntegration.test.ts`
- Offline attested release and CLI: `diagnosticRelease.test.ts`, `releaseDiagnosticsCli.test.ts` (synthetic evidence only; no live EOS releases)
- Shared test helpers: `test/helpers.ts`
