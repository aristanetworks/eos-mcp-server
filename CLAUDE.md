# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (compile TypeScript to dist/)
make build          # or: npm run build

# Type-check without emitting
make typecheck      # or: npm run typecheck

# Run all tests
make test           # or: npm test

# Clean build artifacts
make clean

# Build distributable .tgz package
make pack

# Install dependencies from lockfile
make install-deps   # or: npm ci

# Run a single test file
npx vitest run test/inventory.test.ts

# Run in dev mode (no compilation step)
npm run dev -- serve --inventory path/to/inventory.yaml

# CLI usage after build
node dist/index.js --version
node dist/index.js serve --inventory path/to/inventory.yaml [--config path/to/config.yaml] [--enable-write]
node dist/index.js validate-inventory --inventory path/to/inventory.yaml [--json] [--inventory-only]
node dist/index.js print-server-info [--inventory path/to/inventory.yaml] [--json]
```

## Architecture

This is a TypeScript ESM-only Node 20+ MCP server that exposes Arista EOS network devices via the Model Context Protocol over stdio. It uses the official `@modelcontextprotocol/sdk`, `zod` for schema validation, and `yaml` for inventory parsing.

### Source layout

- `src/index.ts` — main entry; dispatches CLI commands (serve, validate-inventory, print-server-info)
- `src/cli.ts` — argument parsing; produces `CliOptions`
- `src/core/version.ts` — reads `APP_NAME` and `APP_VERSION` from `package.json` at runtime
- `src/config/` — server config file schema (`schema.ts`) and loader (`loadConfig.ts`)
- `src/inventory/` — inventory loading/validation (`loadInventory.ts`), target resolution (`resolveTarget.ts`), list view builder (`listInventoryView.ts`), and types (`types.ts`)
- `src/connection/` — eAPI connection resolution: credentials, TLS, endpoint, timeout (`resolveConnection.ts`)
- `src/eapi/` — low-level EOS JSON-RPC HTTP client (`client.ts`), transport (`transport.ts`), command input validation (`commands.ts`), and shared types including `EosCommandRunner`, `EapiCommandOptions`, and `extractEapiResults` (`types.ts`)
- `src/probe/`, `src/show/`, `src/facts/`, `src/configuration/` — read-path service implementations
- `src/mcp/createServer.ts` — wires all MCP tools into the SDK server and connects the stdio transport
- `src/mcp/tools/` — one file per MCP tool; each exports an input schema and a result builder
- `src/serverInfo/`, `src/commands/` — server info types and CLI command runners
- `src/utils/` — shared type-narrowing utilities (`value.ts`: `isObject`, `readString`, `readBoolean`, `readNumber`, etc.), path resolution (`path.ts`), and JSON formatting (`json.ts`)

### Data flow

1. `main()` loads config → loads inventory into an `InventoryModel`
2. `startMcpServer` creates an `EapiClient` and registers all tool handlers
3. Each tool call runs: input validation (zod) → target resolution (`resolveInventoryTarget`) → per-host connection resolution (`resolveEapiConnection`) → eAPI HTTP call(s) → structured result envelope

### Key design rules enforced in code

- **Inventory is authoritative**: targets must be inventory host/group names; no ad hoc IPs
- **Canonical groups merge**: a group referenced under multiple parents has its hosts/children unioned and vars merged (later wins), matching Ansible semantics
- **Fail-closed**: mixed eligibility in a group target is an error, not a partial success
- **`mcp_write_allowed` is deny-dominant**: a child cannot override an ancestor's `false`
- **`all` is write-forbidden**: enforced in `resolveInventoryTarget`
- **Password source**: exactly one of `mcp_password_env` (preferred) or `ansible_password` must resolve per host; env var names must match an allowed prefix (`EOS_MCP_` by default)
- **`eos_run_show`**: only single-line `show ...` commands accepted; commands are trimmed and validated before dispatch
- **`eos_get_running_config`**: group targets require an explicit single-line `section` string; automatically enters enable mode via eAPI since `show running-config` requires privileged access
- **Enable mode**: the eAPI client supports opt-in enable mode (`{ enable: true }` option on `runShowCommands`/`runCommands`) for privileged commands; it prepends `enable` to the wire commands and strips the extra result entry from the response transparently
- **Overall timeout**: `overallOperationTimeoutMs` aborts in-flight read eAPI requests and stops scheduling new devices
- **Response-size controls**: `executeReadOperation` enforces `maxResponseSizeBytes` (default 1MB) on serialized results; each service provides context-specific narrowing guidance
- **Normalized output**: `eos_run_show` returns `NormalizedCommandResult[]` (`{ command, output }` pairs) by default; raw eAPI payloads are opt-in via `include_raw`
- **`include_raw` pattern**: `eos_get_facts`, `eos_run_show`, and `eos_probe_devices` all support an `include_raw` flag for raw eAPI payload access (default false)
- **Typed errors**: all error paths use `AppError(code, message)` with machine-readable error codes; no plain `Error` throws

### Implementation status

Read-path tools are fully implemented and tested (86 unit tests, 11 integration tests against cEOS 4.34.3M). Phase 1 read-only MVP is complete. The write path (`eos_preview_config`, `eos_apply_config`, `eos_save_config`) is not yet implemented. The next planned work is Phase 2: global write lock and runtime orchestration (see `docs/CHECKPOINT.md`).

### Documentation

Project documentation lives in `docs/`:

- `docs/design-overview.md` — design overview for evaluators
- `docs/DESIGN.md` — detailed design specification
- `docs/IMPLEMENTATION_PLAN.md` — execution plan and phase tracking
- `docs/CHECKPOINT.md` — current implementation status
- `docs/CODE_WALKTHROUGH.md` — source layout and module guide

### TypeScript strictness

The config enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — always type array accesses with explicit undefined handling and never conflate `undefined` with absent optional properties.
