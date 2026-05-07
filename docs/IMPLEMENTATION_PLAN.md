# EOS MCP Server Implementation Plan

## Purpose

This document translates the design specification (`DESIGN.md`) into an execution plan that matches the current state of the repository.

The project is no longer at the scaffold stage. The immediate goal is to ship a solid **Phase 1 read-only MVP**, then layer in the write path as a later phase.

## Current State

Implemented and test-backed today:
- TypeScript + Node 20+ + ESM packaging
- CLI entrypoint with:
  - `serve`
  - `validate-inventory`
  - `print-server-info`
  - `probe`
- server config loading and path resolution
- inventory parsing and validation for:
  - canonical Ansible-style YAML
  - simplified YAML
- inventory-derived policy and eligibility evaluation
- target resolution with fail-closed read/write prechecks
- connection resolution for endpoint, username, password source, TLS mode, and timeouts
- EOS eAPI HTTPS JSON-RPC client
- read-path services:
  - `eos_get_server_info`
  - `eos_list_inventory`
  - `eos_probe_devices`
  - `eos_run_show`
  - `eos_get_facts`
  - `eos_get_running_config`
- MCP stdio server wiring
- top-level `README.md` with operator guidance and MCP setup examples
- read-only MVP guardrail: startup rejects `enableWrite=true` and `allowDirectConfigFallback=true`
- `validate-inventory` effective mode now uses resolved config and startup-style connection validation
- shared error helpers / typed `AppError` foundation
- shared MCP tool result helper and shared read-operation result envelope helper
- CA bundle caching in the HTTPS transport
- inventory subsystem refactored into parse/normalize/validate/build-model modules

## Guiding Principles

Implementation should continue to preserve these priorities:
- fail closed wherever ambiguity exists
- keep inventory as the authoritative trust boundary
- keep server-side validation strict
- separate read and write concerns clearly
- ship a polished read-only phase before introducing mutation paths
- make runtime behavior inspectable and testable

## Delivery Phases

## Phase 1: Read-Only MVP

### Scope
Phase 1 is the first shippable release and is intentionally limited to read-only behavior.

### Required behaviors
The Phase 1 release should provide:
- inventory-authoritative targeting only
- strict inventory validation and safe naming rules
- EOS eligibility detection and fail-closed read targeting
- exact host/group targeting with deterministic ordering
- password source enforcement:
  - exactly one of `mcp_password_env` or `ansible_password`
  - env var name prefix enforcement
- HTTPS eAPI access with:
  - TLS validation on by default
  - optional CA bundle
  - optional per-target `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`)
- read-path MCP tools:
  - `eos_get_server_info`
  - `eos_list_inventory`
  - `eos_probe_devices`
  - `eos_run_show`
  - `eos_get_facts`
  - `eos_get_running_config`
- local admin commands:
  - `validate-inventory`
  - `print-server-info`
  - `probe`
- strict `show ...` validation for `eos_run_show`
- group `eos_get_running_config` requiring an explicit `section`
- read concurrency and target-count limits
- read-only startup posture that rejects write enablement

### Current gaps to close or explicitly accept
The main remaining Phase 1 gaps are:

#### 1. Response-size controls for read tools -- COMPLETED
`maxResponseSizeBytes` config field (default 1 MB) added and enforced in `executeReadOperation`. Returns `AppError("response_size_exceeded")` with structured details and per-tool narrowing guidance. 8 tests cover limit enforcement, error shape, and guidance rendering.

#### 2. `eos_run_show` output shaping cleanup -- COMPLETED
Command results normalized into `NormalizedCommandResult[]` with `{ command, output }` pairs. Raw eAPI payload exposure is now behind an `include_raw` opt-in flag (default false). 4 tests cover the normalized shape and raw opt-in behavior.

#### 3. Error-model polish for operator workflows -- COMPLETED
All plain `throw new Error(...)` calls converted to `throw new AppError(code, message)` with a consistent error taxonomy. `eos_probe_devices` raw result is now behind `include_raw` flag (default false). 5 tests for error taxonomy, 2 tests for probe raw opt-in.

#### 4. Real EOS / cEOS integration validation -- COMPLETED
All 11 integration tests pass against cEOS 4.34.3M. All 8 lab devices probed successfully. Normalized output confirmed working against real devices. TLS behavior validated in lab scenarios.

#### 5. Release prep and examples
Before shipping Phase 1, we should still add or verify:
- release notes for the read-only MVP scope
- example inventories/config files
- copy-paste examples for common probe/show flows
- explicit explanation that write-mode flags are reserved and rejected in Phase 1
- `npm pack` contents and clean install/run flow

### Phase 1 work plan

#### Step 1: response-size enforcement -- COMPLETED
- `maxResponseSizeBytes` config field added (default 1 MB)
- enforced in `executeReadOperation` for show/facts/running-config services
- returns `AppError("response_size_exceeded")` with per-tool narrowing guidance

#### Step 2: read-path result-shape cleanup -- COMPLETED
- `eos_run_show` output normalized into `NormalizedCommandResult[]` with `{ command, output }`
- `eos_probe_devices` raw result moved behind `include_raw` opt-in
- default MCP responses are sanitized and stable; raw payloads require explicit opt-in

#### Step 3: real-device validation -- COMPLETED
- all 11 integration tests pass against cEOS 4.34.3M
- 8 lab devices probed successfully
- normalized output confirmed working against real devices

#### Step 4: release packaging
- verify `npm pack` contents
- verify CLI install/run flow from a clean environment
- add example MCP client configuration snippets

### Phase 1 exit criteria
Phase 1 is ready to ship when:
- the server remains strictly read-only at startup -- MET
- all six read MCP tools work end-to-end against real EOS/cEOS -- MET (cEOS 4.34.3M, 11 integration tests, 8 lab devices)
- operator docs exist and cover inventory, secrets, and TLS usage -- MET
- response-size behavior is explicit and predictable -- MET (`maxResponseSizeBytes` enforced with structured errors and narrowing guidance)
- `validate-inventory` meaningfully supports the intended operator workflow -- MET
- the minimum supported EOS version for read operations is documented -- REMAINING (release prep)

Remaining work before Phase 1 ship: release packaging (Step 4) and final documentation pass.

---

## Phase 2: Write-Path Foundation and Tools

Phase 2 begins only after the read-only MVP is stable.

### Phase 2 scope
- global write lock / runtime orchestration
- config command normalization and validation
- signed preview artifact model
- `eos_preview_config`
- `eos_apply_config`
- `eos_save_config`
- structured audit logging for config change workflows
- write-path integration testing and release hardening

### Recommended Phase 2 order
1. global write lock / runtime orchestration
2. config command normalization and validation
3. preview artifact signing and verification
4. `eos_preview_config`
5. `eos_apply_config`
6. `eos_save_config`
7. structured audit logging
8. real EOS write-path integration testing

## Internal Module Follow-Ups

The current module layout is workable. The most likely additions for remaining work are:

```text
src/
  runtime/
    readLimits.ts
    requestErrors.ts
    diagnostics.ts
    writeLock.ts
    operationRunner.ts
  logging/
    audit.ts
  preview/
    artifact.ts
    signing.ts
  validation/
    responseSize.ts
    configCommands.ts
```

Not all of these are required for Phase 1. For the read-only MVP, the most valuable additions are:
- shared request-level error constants
- response-size enforcement helpers
- optional audit/diagnostic helpers

## Testing Plan From Here

### Phase 1 tests -- current status
- config-aware `validate-inventory` tests -- existing
- response-size limit tests for read tools -- ADDED (8 tests covering limit enforcement, error shape, and guidance)
- result-shape tests for sanitized vs raw output behavior -- ADDED (4 tests for `eos_run_show` normalized output and `include_raw`; 2 tests for `eos_probe_devices` `include_raw`)
- error taxonomy tests -- ADDED (5 tests for `AppError` consistency across all throw sites)
- CLI golden-path tests for common failures:
  - missing env var
  - bad TLS / cert validation
  - unknown target
  - oversized request
- real cEOS/EOS integration tests -- ADDED (11 integration tests passing against cEOS 4.34.3M):
  - probe
  - run-show
  - get-facts
  - get-running-config

### Phase 2 tests to add later
- write lock behavior
- preview artifact signing/verification
- apply/save orchestration
- partial group failure behavior
- write-path cancellation and timeout handling

## Highest-Risk Areas From Here

### Phase 1 risks
1. inventory/operator confusion around secret env handling and TLS settings
2. large response handling for `show` and running-config reads -- MITIGATED (`maxResponseSizeBytes` enforced)
3. incomplete effective validation semantics in `validate-inventory`
4. insufficient real-device validation before release -- MITIGATED (cEOS 4.34.3M validated)

### Phase 2 risks
1. command validation and denylist design
2. preview artifact integrity model
3. apply-time safety checks
4. group write failure/cancellation semantics

## Definition of Success

### Phase 1 success
A successful Phase 1 release is a polished, documented, test-backed read-only MCP server for EOS.

### Full product success
A successful later release adds the write path only after preview/apply/save safety mechanisms, locking, validation, and auditability are in place.
