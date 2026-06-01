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
  - `eos_show_logging`
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
  - `eos_show_logging`
  - `eos_get_facts`
  - `eos_get_running_config`
- local admin commands:
  - `validate-inventory`
  - `print-server-info`
  - `probe`
- strict single-line `show ...` validation for `eos_run_show`
- group `eos_get_running_config` requiring an explicit single-line `section`
- read command inputs reject CLI output modifiers and shell metacharacters before device contact
- read concurrency and target-count limits
- overall read-operation timeout cancellation through `AbortSignal`
- read-only startup posture that rejects write enablement

### Previously Identified Gaps
The main Phase 1 gaps have been closed or explicitly scoped:

#### 1. Response-size controls for read tools -- COMPLETED
`maxResponseSizeBytes` config field (default 1 MB) added and enforced in both the production HTTPS transport and the shared final read-tool result envelope. Oversized device HTTP responses are rejected before full buffering, and oversized aggregate tool results return `AppError("response_size_exceeded")` with structured details and per-tool narrowing guidance. Tests cover transport-level caps, aggregate limit enforcement, error shape, and guidance rendering.

#### 2. `eos_run_show` output shaping cleanup -- COMPLETED
Command results normalized into command-aligned result entries with `{ command, output_format, output }`. Raw eAPI detail is behind an `include_raw` opt-in flag (default false) and attaches as `raw_entry` on each command result. 4 tests cover the normalized shape and raw opt-in behavior.

#### 3. Error-model polish for operator workflows -- COMPLETED
All plain source `throw new Error(...)` calls converted to `throw new AppError(code, message)` with a consistent error taxonomy. Per-device read failures preserve underlying `AppError.code` values when available. `eos_probe_devices` raw result is now behind `include_raw` flag (default false). 7 tests cover request-level and per-device error taxonomy, with 2 tests for probe raw opt-in.

#### 4. Real EOS / cEOS integration validation -- COMPLETED
All 12 integration tests pass against cEOS 4.34.3M. All 8 lab devices probed successfully. Normalized output confirmed working against real devices. TLS behavior validated in lab scenarios.

#### 5. Release prep and examples -- COMPLETED
- package `prepack` builds from source before `npm pack`
- `npm run lint` / `npm run static-policy` enforce lightweight source policy checks
- package policy tests cover `prepack`, lint script exposure, and package-lock root version alignment
- `npm pack --dry-run` contents verified
- operator docs include example inventories/config files, common probe/show flows, and write-mode flag rejection guidance

### Phase 1 work plan

#### Step 1: response-size enforcement -- COMPLETED
- `maxResponseSizeBytes` config field added (default 1 MB)
- enforced in the HTTPS transport before buffering oversized device responses
- enforced on the shared final result envelope for aggregate show/facts/probe/running-config service results
- returns `AppError("response_size_exceeded")` with per-tool narrowing guidance

#### Step 2: read-path result-shape cleanup -- COMPLETED
- `eos_run_show` output normalized into `NormalizedCommandResult[]` with `{ command, output }`
- `eos_probe_devices` raw eAPI detail moved behind `include_raw` opt-in and is exposed as per-command `raw_entry` data
- default MCP responses are sanitized and stable; raw per-command eAPI entries require explicit opt-in

#### Step 3: real-device validation -- COMPLETED
- all 12 integration tests pass against cEOS 4.34.3M
- 8 lab devices probed successfully
- normalized output confirmed working against real devices

#### Step 4: release packaging -- COMPLETED
- `npm pack --dry-run` verified
- `prepack` runs `npm run build`
- example MCP client configuration snippets added
- static policy lint command added

### Phase 1 exit criteria
Phase 1 is ready to ship when:
- the server remains strictly read-only at startup -- MET
- all seven read MCP tools work end-to-end against real EOS/cEOS -- MET (cEOS 4.34.3M, 12 integration tests, 8 lab devices)
- operator docs exist and cover inventory, secrets, and TLS usage -- MET
- response-size behavior is explicit and predictable -- MET (`maxResponseSizeBytes` enforced with structured errors and narrowing guidance)
- `validate-inventory` meaningfully supports the intended operator workflow -- MET
- the minimum supported EOS version for read operations is documented -- MET

Remaining work before Phase 1 ship: none currently identified.

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
- optional audit/diagnostic helpers

## Testing Plan From Here

### Phase 1 tests -- current status
- config-aware `validate-inventory` tests -- existing
- response-size limit tests for read tools -- ADDED (transport cap plus aggregate limit enforcement, error shape, and guidance)
- command-policy tests -- ADDED (risky output modifiers/metacharacters rejected before device contact)
- result-shape tests for sanitized vs raw output behavior -- ADDED (4 tests for `eos_run_show` normalized output and `include_raw`; 2 tests for `eos_probe_devices` `include_raw`)
- error taxonomy tests -- ADDED (7 tests for request-level and per-device `AppError` behavior)
- package policy tests -- ADDED (`prepack`, lint/static policy scripts, package-lock version alignment)
- CLI golden-path tests for common failures:
  - missing env var
  - bad TLS / cert validation
  - unknown target
  - oversized request
- real cEOS/EOS integration tests -- ADDED (12 integration tests passing against cEOS 4.34.3M):
  - probe
  - run-show
  - show-logging
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
2. large response handling for `show` and running-config reads -- MITIGATED (`maxResponseSizeBytes` enforced in transport and final result envelopes)
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
