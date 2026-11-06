# Code Walkthrough

## Top Level

This repository is a single TypeScript/Node package.

- `src/` contains all source code.
- `test/` contains Vitest tests.
- `dist/` is generated build output from `tsc`.
- `docs/` contains project documentation (design, checkpoint, implementation plan, etc.).
- `Makefile` wraps build, lint/static policy checks, test, typecheck, clean, and packaging.
- `package.json` defines scripts: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. `typecheck` uses `tsconfig.test.json`, which extends the build config to cover `test/` as well as `src/`, because Vitest does not type-check. The package `prepack` hook runs `npm run build`.
- `scripts/static-policy.mjs` performs lightweight source policy checks for banned patterns such as plain `throw new Error`, `@ts-ignore`, `eslint-disable`, and `as any`.

## Runtime Entry

Execution starts at `src/index.ts`. It parses CLI args, loads config, then dispatches one of six commands:

- `serve`: load inventory, validate startup credentials, start MCP stdio server.
- `validate-inventory`: validate inventory and print the result.
- `print-server-info`: print sanitized server metadata.
- `probe`: run the same probe logic as the MCP probe tool.

CLI parsing lives in `src/cli.ts`. The app name and version are read from `package.json` at runtime via `src/core/version.ts`. Shared error handling lives in `src/core/errors.ts`, which defines `AppError` and the stable machine-readable error codes used across the CLI and MCP layers.

## Config And Inventory

Config loading is in `src/config/loadConfig.ts`, with Zod schemas in `src/config/schema.ts`. Diagnostic defaults and cross-setting budget validation live in `src/config/diagnostics.ts`. It merges optional config-file values with CLI overrides and resolves paths.

`src/inventory/loadInventory.ts` orchestrates inventory loading. It supports simplified YAML and canonical Ansible-style YAML by delegating to a pipeline: parsing (`src/inventory/parse.ts`), schema detection and normalization (`src/inventory/normalize.ts`), structural and variable-type validation (`src/inventory/validateNormalized.ts`, `src/inventory/varValidation.ts`), and model construction (`src/inventory/buildModel.ts`). Together these validate structure, build effective host vars, resolve groups, and produce an `InventoryModel`.

Supporting inventory modules:

- `src/inventory/types.ts`: public inventory model types.
- `src/inventory/internalTypes.ts` / `src/inventory/internalUtils.ts`: shared types and helpers used across the parsing/normalization/validation pipeline.
- `src/inventory/effectiveVars.ts`: global/group/host variable inheritance and same-depth conflict handling.
- `src/inventory/graph.ts`: group parent maps, group depths, host lineage, direct memberships, and resolved group hosts.
- `src/inventory/policy.ts`: EOS eligibility and read access evaluation, including `mcp_read_allowed`, the `mcp_diagnostics_allowed` opt-out (default allowed), and the `mcp_packet_capture_allowed` opt-out above it (read denial vetoes all three; diagnostic denial also vetoes capture).
- `src/inventory/resolveTarget.ts`: host/group target resolution and policy fail-closed checks.
- `src/inventory/listInventoryView.ts`: sanitized inventory view for MCP output.

## Connection And eAPI

Connection resolution is in `src/connection/resolveConnection.ts`. It turns effective host vars plus server config into an eAPI connection: endpoint, username, password, TLS flags, CA file, timeout, eAPI output version, and response-size limit.

`src/connection/eosDeviceReader.ts` defines the host-oriented `EosDeviceReader` interface. Its `EapiDeviceReader` adapter owns per-host connection resolution and delegates command execution to the low-level eAPI runner.

Startup credential validation is in `src/connection/validateStartupConnections.ts`.

eAPI protocol and transport are split:

- `src/eapi/client.ts`: builds JSON-RPC `runCmds` requests using the connection's `eapiVersion` (`"latest"` by default, `1` when pinned in config), handles HTTP errors, invalid JSON, protocol version/response-ID correlation, exclusive result/error envelopes, JSON-RPC errors, and unexpected result counts. Supports opt-in enable mode (`{ enable: true }`) for privileged commands by prepending `enable` to the wire commands and stripping the extra result entry transparently. Per-request timeout and caller cancellation are combined with `AbortSignal`.
- `src/eapi/transport.ts`: production HTTPS transport and test-friendly fetch transport. The production transport enforces `maxResponseSizeBytes` while chunks are received, before buffering an oversized device response.
- `src/eapi/client.ts` also exposes single-execution text commands for active diagnostics, without JSON fallback retries, using the reserved request identity supplied by the diagnostic execution context.
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

Every tool that runs on a Target, read or diagnostic, goes through `runTargetOperation` in `src/operations/targetOperation.ts`. It takes the Target, a per-host `run` that returns that host's entries (one for a read, one per destination for a ping), and the call's concurrency and deadline, and returns the finished response. It resolves the Target, enforces `maxReadTargets` and an optional `validateTarget` before contacting any host, bounds the call by its deadline (naming the setting that controls it) and the caller's signal, turns a host's throw into that host's failed entry with the caller's fallback code (an `AppError`'s own code wins), and builds the summary and response, always enforcing `maxResponseSizeBytes`. Read tools take `readOperationLimits(config)` (`readFanOut` hosts at once, the top-level `overallOperationTimeoutMs`); the diagnostic executor starts every host at once and lets the eAPI slots schedule, under its definition's deadline. `buildDeviceSuccess`/`buildDeviceFailure` build entries, and `DeviceResultSummary` is the summary type all result interfaces share.

Shared type-narrowing utilities (`isObject`, `readString`, `readBoolean`, `readNumber`, etc.) live in `src/utils/value.ts`.

## Diagnostic Execution

- `src/diagnostics/executor.ts`: typed diagnostic orchestration, the per-kind inventory permission and aggregate budget checks, existing result envelopes, and cancellation. One executor is created per server instance.
- `src/operations/eapiSlots.ts`: in-memory admission shared by every eAPI request in one server process. Reads and diagnostics share each device's slots; diagnostics also have a per-device share and a server-wide ceiling, and a kind may bring its own per-device limit with each request. Slots count diagnostics by the kind name the executor passes and attach no other meaning to it. It also owns the capacity snapshot types reported by server info. `EapiDeviceReader` holds a read slot per request. Waiters are served oldest first, skipping those that cannot run yet. Unknown completion holds a slot for that execution's own budget (`commandTimeoutMs` for ping, window plus 2 s for a packet capture), then a timer frees it; a late confirmed response frees it sooner. Shutdown rejects queued work; cancelled waiters are removed.
- `src/diagnostics/eapiRunner.ts`: connection resolution followed by one text eAPI attempt in enable mode, sending the command, HTTP timeout, and EOS request timer from the kind's `eapiExecution` plan. Separate error paths distinguish local rejection before dispatch from uncertain RPC, transport, or malformed-result failures after dispatch; there is no mutable dispatch flag or retry.
- `src/diagnostics/definitions.ts`: the table of `DiagnosticDefinition`s by kind, shared by the executor and the eAPI runner.
- `src/diagnostics/validation.ts`: validation shared by diagnostic kinds: the VRF identifier check and bounded integer settings.
- `src/diagnostics/ping.ts`: literal-address/VRF/source/count validation, finite ping command construction, and loss/RTT interpretation. A no-reply finding is not an execution failure.
- `src/diagnostics/packetCapture.ts`: interface/VRF/filter/count/window validation, `tcpdump` command construction with the filter last, the packet budget, the window-based uncertain hold, and the complete **Capture Finding** carrying tcpdump's lines verbatim.
- `src/diagnostics/types.ts`: request, prepared intent, and finding types discriminated by diagnostic kind (`ping`, `packet_capture`), the kind-free observation (command output, or the device time limit), the `DiagnosticDefinition` seam, and the `DiagnosticDeviceRunner` seam. There are no capture sessions.

Diagnostic execution reuses read-operation orchestration with independent settings and per-device admission under a server-wide ceiling. Unknown completion holds capacity for the execution's own budget; HTTP abort is not a remote kill signal. Each server-info call reads `DiagnosticExecutor.getCapacity()` afresh; the standalone CLI reports no live snapshot.

Capacity lives in memory per server process, so several servers can run against one inventory. See [DIAGNOSTICS.md](DIAGNOSTICS.md) [ADR 0006](adr/0006-in-memory-timed-diagnostic-capacity.md), and [ADR 0007](adr/0007-per-device-diagnostic-concurrency.md).

## MCP Layer

The MCP server is assembled in `src/mcp/createServer.ts`. It creates the official SDK `McpServer`, registers nine non-configuring tools, and connects over stdio. Ping and packet capture forward the MCP cancellation signal into diagnostic execution.

Tool adapters live under `src/mcp/tools/`:

- `getServerInfo.ts`
- `listInventory.ts`
- `probeDevices.ts`
- `ping.ts`
- `packetCapture.ts`
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
- Read services and orchestration: `probeDevices.test.ts`, `runShow.test.ts`, `loggingQuery.test.ts`, `showLogging.test.ts`, `getFacts.test.ts`, `getRunningConfig.test.ts`, `targetOperation.test.ts`
- Diagnostics: `ping.test.ts`, `diagnosticConfig.test.ts`, `diagnostics.test.ts`, `diagnosticEapi.test.ts`, `diagnosticReservations.test.ts` (timed release, cancellation, late responses and visibility), `packetCapture.test.ts` (capture validation, command, finding), `packetCaptureExecution.test.ts` (capture permission, fan-out, budget, uncertain hold, tool schema)
- Response correlation: `eapiCorrelation.test.ts`
- Server info and errors: `buildServerInfo.test.ts`, `errors.test.ts`, `errorTaxonomy.test.ts`
- MCP adapters and stdio: `readToolsMcp.test.ts`, `probeDevicesTool.test.ts`, `listInventoryTool.test.ts`, `mcpStdioSmoke.test.ts`
- Package/static policy: `packagePolicy.test.ts`, `packageSmoke.test.ts`
- Optional cEOS integration (requires a configured lab): `integration.test.ts`, `pingIntegration.test.ts`, `pingMcpIntegration.test.ts`, `packetCaptureIntegration.test.ts`
- Shared test helpers: `test/helpers.ts`
