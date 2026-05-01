# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (compile TypeScript to dist/)
npm run build

# Type-check without emitting
npm run typecheck

# Run all tests
npm test

# Run a single test file
npx vitest run test/inventory.test.ts

# Run in dev mode (no compilation step)
npm run dev -- serve --inventory path/to/inventory.yaml

# CLI usage after build
node dist/index.js serve --inventory path/to/inventory.yaml [--config path/to/config.yaml] [--enable-write]
node dist/index.js validate-inventory --inventory path/to/inventory.yaml [--json] [--inventory-only]
node dist/index.js print-server-info [--inventory path/to/inventory.yaml] [--json]
```

## Architecture

This is a TypeScript ESM-only Node 20+ MCP server that exposes Arista EOS network devices via the Model Context Protocol over stdio. It uses the official `@modelcontextprotocol/sdk`, `zod` for schema validation, and `yaml` for inventory parsing.

### Source layout

- `src/index.ts` — main entry; dispatches CLI commands (serve, validate-inventory, print-server-info)
- `src/cli.ts` — argument parsing; produces `CliOptions`
- `src/config/` — server config file schema (`schema.ts`) and loader (`loadConfig.ts`)
- `src/inventory/` — inventory loading/validation (`loadInventory.ts`), target resolution (`resolveTarget.ts`), list view builder (`listInventoryView.ts`), and types (`types.ts`)
- `src/connection/` — eAPI connection resolution: credentials, TLS, endpoint, timeout (`resolveConnection.ts`)
- `src/eapi/` — low-level EOS JSON-RPC HTTP client (`client.ts`) and types (`types.ts`)
- `src/probe/`, `src/show/`, `src/facts/`, `src/configuration/` — read-path service implementations
- `src/mcp/createServer.ts` — wires all MCP tools into the SDK server and connects the stdio transport
- `src/mcp/tools/` — one file per MCP tool; each exports an input schema and a result builder
- `src/serverInfo/`, `src/commands/` — server info types and CLI command runners

### Data flow

1. `main()` loads config → loads inventory into an `InventoryModel`
2. `startMcpServer` creates an `EapiClient` and registers all tool handlers
3. Each tool call runs: input validation (zod) → target resolution (`resolveInventoryTarget`) → per-host connection resolution (`resolveEapiConnection`) → eAPI HTTP call(s) → structured result envelope

### Key design rules enforced in code

- **Inventory is authoritative**: targets must be inventory host/group names; no ad hoc IPs
- **Fail-closed**: mixed eligibility in a group target is an error, not a partial success
- **`mcp_write_allowed` is deny-dominant**: a child cannot override an ancestor's `false`
- **`all` is write-forbidden**: enforced in `resolveInventoryTarget`
- **Password source**: exactly one of `mcp_password_env` (preferred) or `ansible_password` must resolve per host; env var names must match an allowed prefix (`EOS_MCP_` by default)
- **`eos_run_show`**: only `show ...` commands accepted; validated before dispatch
- **`eos_get_running_config`**: group targets require an explicit `section` string

### Implementation status

Read-path tools are fully implemented and tested. The write path (`eos_preview_config`, `eos_apply_config`, `eos_save_config`) is not yet implemented. The next planned work is the global write lock and runtime orchestration (see `CHECKPOINT.md`).

### TypeScript strictness

The config enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — always type array accesses with explicit undefined handling and never conflate `undefined` with absent optional properties.
