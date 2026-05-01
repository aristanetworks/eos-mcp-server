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
- **17 test files**
- **51 passing tests**
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
- probe behavior
- run-show behavior
- get-facts behavior
- running-config behavior
- MCP read-tool adapters
- stdio MCP smoke test

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

## Phase 1 Remaining Gaps

The main remaining work before calling Phase 1 complete is:
1. add explicit response-size limits and narrowing guidance for read tools
2. tighten default output shaping vs optional raw/debug payload exposure
3. improve request-level/operator-facing error rendering consistency across CLI and MCP
4. run real cEOS/EOS integration validation for the read path
5. choose and document the minimum supported EOS version for read operations
6. prepare final release packaging/examples pass (`npm pack`, install/run flow, MCP client examples sanity check)

## Recommended Resume Point

If resuming work for Phase 1, the recommended next step is:

### **Read response-size enforcement**

Start with:
- `eos_run_show`
- `eos_get_facts`
- `eos_get_running_config`

Recommended order:
1. define config/schema for read response-size limits if needed
2. enforce per-device and aggregate limits in the read services
3. return explicit narrowing guidance instead of silent truncation
4. add tests for oversized show/facts/running-config responses

### After response-size enforcement
Continue with:
1. read-path output-shape cleanup
   - especially `eos_run_show` normalized/default output contract
   - decide whether `probeDevices` should keep returning `raw_result` by default
2. real cEOS/EOS integration validation
3. release packaging and final docs/examples verification

## Suggested Re-entry Reading List

When resuming, start here:
- `CHECKPOINT.md`
- `README.md`
- `IMPLEMENTATION_PLAN.md`

Then inspect the main code paths:
- `src/commands/validateInventory.ts`
- `src/operations/readExecution.ts`
- `src/show/runShow.ts`
- `src/facts/getFacts.ts`
- `src/configuration/getRunningConfig.ts`
- `src/inventory/loadInventory.ts`
- `src/inventory/normalize.ts`
- `src/inventory/validateNormalized.ts`
- `src/inventory/buildModel.ts`

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
