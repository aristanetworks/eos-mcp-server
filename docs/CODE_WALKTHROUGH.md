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

Execution starts at `src/index.ts`. It parses CLI args, loads config, then dispatches one of four commands:

- `serve`: load inventory, validate startup credentials, start MCP stdio server.
- `validate-inventory`: validate inventory and print the result.
- `print-server-info`: print sanitized server metadata.
- `probe`: run the same probe logic as the MCP probe tool.

CLI parsing lives in `src/cli.ts`. The app name and version are read from `package.json` at runtime via `src/core/version.ts`.

## Config And Inventory

Config loading is in `src/config/loadConfig.ts`, with Zod schemas in `src/config/schema.ts`. It merges optional config-file values with CLI overrides and resolves paths.

Inventory parsing and modeling is in `src/inventory/loadInventory.ts`. It supports simplified YAML and canonical Ansible-style YAML, validates structure, builds effective host vars, resolves groups, and produces an `InventoryModel`.

Supporting inventory modules:

- `src/inventory/types.ts`: inventory model types.
- `src/inventory/effectiveVars.ts`: global/group/host variable inheritance and same-depth conflict handling.
- `src/inventory/graph.ts`: group parent maps, group depths, host lineage, direct memberships, and resolved group hosts.
- `src/inventory/policy.ts`: EOS eligibility and read access evaluation.
- `src/inventory/resolveTarget.ts`: host/group target resolution and policy fail-closed checks.
- `src/inventory/listInventoryView.ts`: sanitized inventory view for MCP output.

## Connection And eAPI

Connection resolution is in `src/connection/resolveConnection.ts`. It turns effective host vars plus server config into an eAPI connection: endpoint, username, password, TLS flags, CA file, timeout, and response-size limit.

Startup credential validation is in `src/connection/validateStartupConnections.ts`.

eAPI protocol and transport are split:

- `src/eapi/client.ts`: builds JSON-RPC `runCmds` requests, handles HTTP errors, invalid JSON, JSON-RPC errors, and unexpected result counts. Supports opt-in enable mode (`{ enable: true }`) for privileged commands by prepending `enable` to the wire commands and stripping the extra result entry transparently. Per-request timeout and caller cancellation are combined with `AbortSignal`.
- `src/eapi/transport.ts`: production HTTPS transport and test-friendly fetch transport. The production transport enforces `maxResponseSizeBytes` while chunks are received, before buffering an oversized device response.
- `src/eapi/types.ts`: shared eAPI types, the unified `EosCommandRunner` interface (used by all read-path services), `EapiCommandOptions`, and helpers for validating/drilling into eAPI JSON-RPC response payloads.

## Read Tool Services

The core read behavior is implemented as service modules:

- `src/probe/probeDevices.ts`: runs `show version` to verify readiness.
- `src/eapi/commands.ts`: normalizes single-line EOS command inputs, rejects risky CLI modifiers/metacharacters, and validates `show` command boundaries.
- `src/show/runShow.ts`: validates strict `show` commands and runs them with `auto`, `json`, or `text` behavior.
- `src/logging/loggingQuery.ts`: validates Log Severity and message-count inputs, applies logging defaults/limits, and builds the EOS logging command.
- `src/logging/showLogging.ts`: executes the bounded Logging Query and returns unparsed log text.
- `src/facts/getFacts.ts`: collects fixed facts from `show version`.
- `src/configuration/getRunningConfig.ts`: returns running config text, requiring `section` for group targets. Uses enable mode since `show running-config` requires privileged access.

All device-facing read services accept an `EosCommandRunner` (defined in `src/eapi/types.ts`) rather than defining their own runner interfaces.

Shared read orchestration lives in `src/operations/readExecution.ts`. It centralizes target resolution, target limits, concurrency, overall timeout cancellation, connection resolution, common per-device result fields, result summaries (including the shared `DeviceResultSummary` type used by all result interfaces), final result-envelope response-size enforcement, and per-device `AppError.code` preservation.

Shared type-narrowing utilities (`isObject`, `readString`, `readBoolean`, `readNumber`, etc.) live in `src/utils/value.ts`.

## MCP Layer

The MCP server is assembled in `src/mcp/createServer.ts`. It creates the official SDK `McpServer`, registers seven read-only tools, and connects over stdio.

Tool adapters live under `src/mcp/tools/`:

- `getServerInfo.ts`
- `listInventory.ts`
- `probeDevices.ts`
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

## Tests

Tests mirror the source layout:

- Inventory and target behavior: `inventory.test.ts`, `targetResolution.test.ts`
- eAPI and connection behavior: `eapiClient.test.ts`, `startupValidation.test.ts`
- Read services: `probeDevices.test.ts`, `runShow.test.ts`, `loggingQuery.test.ts`, `showLogging.test.ts`, `getFacts.test.ts`, `getRunningConfig.test.ts`
- MCP adapters and stdio: `readToolsMcp.test.ts`, `probeDevicesTool.test.ts`, `listInventoryTool.test.ts`, `mcpStdioSmoke.test.ts`
- Package/static policy: `packagePolicy.test.ts`
- Shared test helpers: `test/helpers.ts`
