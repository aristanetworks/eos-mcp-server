# Code Walkthrough

## Top Level

This repository is a single TypeScript/Node package.

- `src/` contains all source code.
- `test/` contains Vitest tests.
- `dist/` is generated build output from `tsc`.
- `DESIGN.md` describes the target architecture.
- `CHECKPOINT.md` captures current implementation status.
- `package.json` defines scripts: `npm test`, `npm run typecheck`, and `npm run build`.

## Runtime Entry

Execution starts at `src/index.ts`. It parses CLI args, loads config, then dispatches one of four commands:

- `serve`: load inventory, validate startup credentials, start MCP stdio server.
- `validate-inventory`: validate inventory and print the result.
- `print-server-info`: print sanitized server metadata.
- `probe`: run the same probe logic as the MCP probe tool.

CLI parsing lives in `src/cli.ts`.

## Config And Inventory

Config loading is in `src/config/loadConfig.ts`, with Zod schemas in `src/config/schema.ts`. It merges optional config-file values with CLI overrides and resolves paths.

Inventory parsing and modeling is in `src/inventory/loadInventory.ts`. It supports simplified YAML and canonical Ansible-style YAML, validates structure, builds effective host vars, resolves groups, and produces an `InventoryModel`.

Supporting inventory modules:

- `src/inventory/types.ts`: inventory model types.
- `src/inventory/policy.ts`: EOS eligibility and read/write access evaluation.
- `src/inventory/resolveTarget.ts`: host/group target resolution and policy fail-closed checks.
- `src/inventory/listInventoryView.ts`: sanitized inventory view for MCP output.

## Connection And eAPI

Connection resolution is in `src/connection/resolveConnection.ts`. It turns effective host vars plus server config into an eAPI connection: endpoint, username, password, TLS flags, CA file, and timeout.

Startup credential validation is in `src/connection/validateStartupConnections.ts`.

eAPI protocol and transport are split:

- `src/eapi/client.ts`: builds JSON-RPC `runCmds` requests, handles HTTP errors and JSON-RPC errors.
- `src/eapi/transport.ts`: production HTTPS transport and test-friendly fetch transport.
- `src/eapi/types.ts`: eAPI types.

## Read Tool Services

The core read behavior is implemented as service modules:

- `src/probe/probeDevices.ts`: runs `show version` to verify readiness.
- `src/show/runShow.ts`: validates `show` commands and runs them with `auto`, `json`, or `text` behavior.
- `src/facts/getFacts.ts`: collects fixed facts from `show version`.
- `src/configuration/getRunningConfig.ts`: returns running config text, requiring `section` for group targets.

Shared read orchestration lives in `src/operations/readExecution.ts`. It centralizes target resolution, target limits, concurrency, caller timeout, connection resolution, and result summaries.

## MCP Layer

The MCP server is assembled in `src/mcp/createServer.ts`. It creates the official SDK `McpServer`, registers six read-only tools, and connects over stdio.

Tool adapters live under `src/mcp/tools/`:

- `getServerInfo.ts`
- `listInventory.ts`
- `probeDevices.ts`
- `runShow.ts`
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
- Read services: `probeDevices.test.ts`, `runShow.test.ts`, `getFacts.test.ts`, `getRunningConfig.test.ts`
- MCP adapters and stdio: `readToolsMcp.test.ts`, `probeDevicesTool.test.ts`, `listInventoryTool.test.ts`, `mcpStdioSmoke.test.ts`
- Shared test helpers: `test/helpers.ts`
