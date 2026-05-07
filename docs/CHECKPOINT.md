# EOS MCP Server Checkpoint

## Checkpoint Summary

The project now has a substantial, test-backed **Phase 1 read-only MVP foundation** and has gone through a meaningful cleanup/refactor pass.

Current product direction remains:
- **Phase 1:** ship a polished read-only MVP
- **Phase 2:** add the write-path foundation and write tools later

The code still explicitly enforces read-only mode by rejecting `enableWrite=true` and `allowDirectConfigFallback=true` at startup.

## What Was Completed In This Work Session

### Read-only MVP guardrails and docs
Completed:
- startup rejects `enableWrite=true`
- startup rejects `allowDirectConfigFallback=true`
- server reports `runtime_mode: "read-only"`
- no write MCP tools are registered
- added top-level `README.md` with:
  - install/build/dev/test instructions
  - canonical and simplified inventory examples
  - password env-var usage guidance
  - TLS guidance and lab troubleshooting
  - CLI usage examples
  - MCP client stdio config examples

### `validate-inventory` hardening
Completed:
- refactored `validate-inventory` to use full resolved server config, not just an inventory path
- `validateInventory(...)` in the inventory layer is now inventory-only by design
- default command behavior now performs:
  - inventory parsing/normalization/validation
  - startup-style connection validation for EOS-eligible hosts using config/default connection settings
- `--inventory-only` now explicitly skips startup connection validation
- startup connection validation errors can now be collected as structured validation errors

Key files:
- `src/commands/validateInventory.ts`
- `src/connection/validateStartupConnections.ts`
- `src/index.ts`
- `src/inventory/loadInventory.ts`

### Read-path refactors and simplification
Completed:
- added shared MCP JSON tool result helper
- simplified MCP tool registration flow
- added shared scalar/value helpers
- added typed `AppError` foundation and shared error helpers
- broadened typed error usage across connection/eAPI/read-path code
- `eos_run_show` auto fallback now keys off error codes rather than string matching in error messages
- added shared read-operation result envelope helper
- CA bundle contents are now cached in the HTTPS transport instead of rereading the CA file for every request

Key files:
- `src/mcp/toolResult.ts`
- `src/utils/value.ts`
- `src/core/errors.ts`
- `src/operations/readExecution.ts`
- `src/eapi/transport.ts`
- `src/show/runShow.ts`
- `src/probe/probeDevices.ts`
- `src/facts/getFacts.ts`
- `src/configuration/getRunningConfig.ts`
- `src/mcp/createServer.ts`

### Inventory subsystem refactor
Completed:
- split the former monolithic `src/inventory/loadInventory.ts` into smaller focused modules
- introduced a dedicated inventory parse stage
- separated normalization, normalized-graph validation, and model building
- removed one duplicate lineage traversal in host effective-var resolution

New/updated files:
- `src/inventory/parse.ts`
- `src/inventory/internalTypes.ts`
- `src/inventory/internalUtils.ts`
- `src/inventory/normalize.ts`
- `src/inventory/validateNormalized.ts`
- `src/inventory/buildModel.ts`
- `src/inventory/loadInventory.ts`

## Current Implemented Surface

### CLI commands
Implemented:
- `serve`
- `validate-inventory`
- `print-server-info`
- `probe`

### MCP tools
Implemented and registered:
- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_run_show`
- `eos_get_facts`
- `eos_get_running_config`

Not yet implemented:
- `eos_preview_config`
- `eos_apply_config`
- `eos_save_config`

## Automated Validation Status

Current automated status:
- **20 test files**
- **86 passing tests**
- `npm test` ✅
- `npm run build` ✅
- `npm run typecheck` ✅

Covered areas now include:
- CLI parsing
- config loading
- core error helpers
- server info generation
- inventory validation
- target resolution
- inventory listing
- connection resolution
- startup connection validation
- `validate-inventory` command behavior
- eAPI client request formation
- probe behavior (with include_raw opt-in)
- run-show behavior (with normalized output and include_raw)
- get-facts behavior
- running-config behavior
- MCP read-tool adapters
- stdio MCP smoke test
- response-size enforcement
- error taxonomy coverage

## Security / Operationally Strict Behavior Already Enforced

The following strict behaviors are already reflected in the implementation:
- strict YAML duplicate-key rejection
- safe identifier pattern for host/group names
- host/group collision rejection
- reserved `all` handling in simplified schema
- group cycle detection
- fail-closed target resolution for read/write access checks
- write-target rejection for `all`
- strict password-source enforcement
- env-prefix restriction for password env vars
- default effective validation includes startup-style connection checks
- `--inventory-only` explicitly skips those startup connection checks
- `show ...`-only validation for run-show
- group running-config requires an explicit section
- normalized/sanitized default MCP response shapes for implemented read tools
- read-only startup posture enforced in config validation

## Recently Completed Phase 1 Work

### Response-size controls
- added `maxResponseSizeBytes` config field (default: 1MB)
- enforced in `executeReadOperation` after device results are collected
- throws `AppError("response_size_exceeded", ...)` with structured details including `guidance`
- each read service provides context-specific narrowing guidance (section filters, fewer devices, etc.)
- 8 new tests in `test/responseSize.test.ts`

### `eos_run_show` output shaping
- command results are now normalized into `NormalizedCommandResult[]` with `{ command, output }` pairs
- JSON format: `output` is the parsed JSON object per command
- text format: `output` is the text string extracted from the eAPI `{ output: "..." }` wrapper
- added `include_raw` opt-in flag for raw eAPI payload pass-through (matching `eos_get_facts` pattern)
- 4 new tests for normalized vs raw output shapes

### `eos_probe_devices` raw result opt-in
- `raw_result` is now opt-in via `include_raw` flag (default false), matching `eos_get_facts` pattern
- MCP tool schema updated with `include_raw: z.boolean().optional().default(false)`
- 2 new tests for include_raw behavior

### Error taxonomy polish
- all `throw new Error(...)` converted to `throw new AppError(code, message)` across the codebase
- error codes added: `cli_missing_value`, `cli_unknown_argument`, `cli_missing_target`, `cli_missing_inventory`, `config_invalid_yaml`, `inventory_validation_failed`, `inventory_invalid_root`, `inventory_unsupported_schema`, `eapi_payload_invalid`
- 5 new tests in `test/errorTaxonomy.test.ts` validating key error codes

### cEOS integration validation
- all 11 integration tests pass against cEOS 4.34.3M (8-node containerlab topology)
- all 8 devices probed successfully via CLI
- normalized `eos_run_show` output confirmed working against real devices
- minimum supported EOS version for read operations documented as 4.20

### Release packaging
- `npm pack` verified: 53.7 KB, 132 files, no test or dev artifacts
- clean `npm install` from `.tgz` confirmed working with CLI `--version` and `--help`

## Phase 1 Status

**Phase 1 is complete.** All read-path tools are implemented, tested (86 unit tests + 11 integration tests), documented, and validated against real cEOS devices. The server is ready for the read-only MVP release.

## Recommended Resume Point

The next work is **Phase 2: write-path foundation**.

## Suggested Re-entry Reading List

When resuming, start here:
- `docs/CHECKPOINT.md`
- `README.md`
- `docs/IMPLEMENTATION_PLAN.md`

Then inspect the main code paths:
- `src/operations/readExecution.ts`
- `src/show/runShow.ts`
- `src/facts/getFacts.ts`
- `src/configuration/getRunningConfig.ts`
- `src/probe/probeDevices.ts`

## Phase 2 Work After Phase 1 Ships

Once the read-only MVP is shipped, the next major milestone becomes the write-path foundation:
1. global write lock / runtime orchestration
2. config command normalization and validation
3. signed preview artifact model
4. `eos_preview_config`
5. `eos_apply_config`
6. `eos_save_config`
7. structured audit logging

## Notes

- The read side is now substantial and already usable.
- The main recent work was hardening and simplification, not feature expansion.
- The inventory trust-boundary code is much easier to navigate than before the refactor.
- The next high-value work is finishing Phase 1 polish, not starting the write path.
