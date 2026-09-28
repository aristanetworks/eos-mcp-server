# AGENTS.md

Repository guidance for Codex and other coding agents working in this project.

## Commands

```bash
# Build TypeScript to dist/
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

# Run in dev mode without compilation
npm run dev -- serve --inventory path/to/inventory.yaml

# CLI usage after build
node dist/index.js --version
node dist/index.js serve --inventory path/to/inventory.yaml [--config path/to/config.yaml]
node dist/index.js validate-inventory --inventory path/to/inventory.yaml [--json] [--inventory-only]
node dist/index.js print-server-info [--inventory path/to/inventory.yaml] [--json]
```

## Architecture

This is a TypeScript ESM-only Node 20+ MCP server that exposes Arista EOS network devices over stdio via the Model Context Protocol. It uses the official `@modelcontextprotocol/sdk`, `zod` for schema validation, and `yaml` for inventory parsing.

### Source Layout

- `src/index.ts` - main entry; dispatches CLI commands (`serve`, `validate-inventory`, `print-server-info`)
- `src/cli.ts` - argument parsing; produces `CliOptions`
- `src/core/version.ts` - reads `APP_NAME` and `APP_VERSION` from `package.json` at runtime
- `src/config/` - server config schema and loader
- `src/inventory/` - inventory loading and validation, target resolution, list views, and types
- `src/connection/` - eAPI connection resolution for credentials, TLS, endpoint, and timeout
- `src/eapi/` - low-level EOS JSON-RPC HTTP client, transport, command input validation, and shared eAPI types
- `src/probe/`, `src/show/`, `src/facts/`, `src/configuration/` - read-path service implementations
- `src/mcp/createServer.ts` - wires MCP tools into the SDK server and stdio transport
- `src/mcp/tools/` - one file per MCP tool; each exports an input schema and result builder
- `src/serverInfo/`, `src/commands/` - server info types and CLI command runners
- `src/utils/` - shared type narrowing, path resolution, and JSON formatting utilities

### Data Flow

1. `main()` loads config, then loads inventory into an `InventoryModel`.
2. `startMcpServer` creates an `EapiClient` and registers all tool handlers.
3. Each tool call runs input validation, target resolution, per-host connection resolution, eAPI HTTP calls, then returns a structured result envelope.

## Design Rules

- Inventory is authoritative: targets must be inventory host or group names; do not allow ad hoc IP targets.
- Canonical groups merge: a group referenced under multiple parents has hosts and children unioned and vars merged, with later vars winning, matching Ansible semantics.
- Fail closed: mixed eligibility in a group target is an error, not a partial success.
- Password source: exactly one of `mcp_password_env` or `ansible_password` must resolve per host. Prefer `mcp_password_env`; env var names must match the configured allowed prefix, `EOS_MCP_` by default.
- `eos_run_show` only accepts single-line `show` commands, validated and trimmed before dispatch.
- `eos_get_running_config` group targets require an explicit single-line `section` string; it enters eAPI enable mode because `show running-config` requires privileged access.
- Enable mode is opt-in on the eAPI client via `{ enable: true }` on `runShowCommands` and `runCommands`; it prepends `enable` and strips the extra response entry transparently.
- `overallOperationTimeoutMs` aborts in-flight read eAPI requests and stops scheduling new devices.
- `executeReadOperation` enforces `maxResponseSizeBytes`, defaulting to 1 MB, on serialized results.
- `eos_run_show` returns normalized `{ command, output }` pairs by default; raw eAPI payloads are opt-in via `include_raw`.
- `eos_get_facts`, `eos_run_show`, and `eos_probe_devices` support `include_raw`, defaulting to `false`.
- All error paths should use `AppError(code, message)` with machine-readable error codes. Avoid plain `Error` throws.

## Implementation Status

Read-only tools are implemented and tested. The product boundary is permanent: configuration-changing operations are out of scope.

## Documentation

- `docs/DESIGN.md` - design and specification overview
- `docs/IMPLEMENTATION_PLAN.md` - implemented scope and maintenance priorities
- `docs/CHECKPOINT.md` - current implementation status
- `docs/CODE_WALKTHROUGH.md` - source layout and module guide

## TypeScript Strictness

The config enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

- Always handle possibly missing array elements explicitly.
- Do not conflate `undefined` with absent optional properties.
