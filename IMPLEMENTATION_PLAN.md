# EOS MCP Server Implementation Plan

## Purpose

This document translates `DESIGN.md` into an execution plan that matches the current state of the repository.

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

#### 1. Response-size controls for read tools
The design calls for explicit response-size limits, but the current implementation does not yet enforce them.

Applies to:
- `eos_run_show`
- `eos_get_facts`
- `eos_get_running_config`

Planned fix direction:
- add per-device and aggregate size limits
- return explicit narrowing guidance instead of silent truncation
- strongly steer large config reads toward section-filtered usage

#### 2. `eos_run_show` output shaping cleanup
Current implementation returns useful data, but the default output contract should be tightened.

Gap:
- sanitized/default output vs optional raw pass-through is not clearly separated yet

Planned fix direction:
- define a stable normalized result shape for default use
- add an explicit opt-in raw/debug field if raw payload exposure remains desirable

#### 3. Error-model polish for operator workflows
The code already returns per-device error codes for many failures, but the overall error taxonomy is still uneven.

Gaps:
- some request-level failures are still plain thrown `Error`s
- common auth/TLS/inventory failures could be rendered more consistently
- CLI diagnostics could better distinguish startup validation failures from per-device runtime failures

Planned fix direction:
- standardize shared request-level error codes/constants
- normalize rendering across CLI and MCP layers

#### 4. Real EOS / cEOS integration validation
Unit and smoke tests are strong, but Phase 1 still needs real-device confidence.

Still needed:
- cEOS lab validation for probe/show/facts/running-config
- TLS behavior validation in common lab scenarios
- evidence for setting a minimum supported EOS version for read-only features

#### 5. Release prep and examples
Before shipping Phase 1, we should still add or verify:
- release notes for the read-only MVP scope
- example inventories/config files
- copy-paste examples for common probe/show flows
- explicit explanation that write-mode flags are reserved and rejected in Phase 1
- `npm pack` contents and clean install/run flow

### Phase 1 work plan

#### Step 1: response-size enforcement
- add config/schema for read response limits if needed
- enforce limits in show/facts/running-config services
- add clear narrowing guidance in returned errors

#### Step 2: read-path result-shape cleanup
- tighten `eos_run_show` output contract
- review whether `eos_probe_devices` should expose raw payloads by default
- ensure default MCP responses are sanitized and stable

#### Step 3: real-device validation
- run the read tools against cEOS/EOS
- document working inventory/TLS patterns
- choose and document the minimum supported EOS version for the read path

#### Step 4: release packaging
- verify `npm pack` contents
- verify CLI install/run flow from a clean environment
- add example MCP client configuration snippets

### Phase 1 exit criteria
Phase 1 is ready to ship when:
- the server remains strictly read-only at startup
- all six read MCP tools work end-to-end against real EOS/cEOS
- operator docs exist and cover inventory, secrets, and TLS usage
- response-size behavior is explicit and predictable
- `validate-inventory` meaningfully supports the intended operator workflow
- the minimum supported EOS version for read operations is documented

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

### Phase 1 tests to add
- config-aware `validate-inventory` tests
- response-size limit tests for read tools
- result-shape tests for sanitized vs raw output behavior
- CLI golden-path tests for common failures:
  - missing env var
  - bad TLS / cert validation
  - unknown target
  - oversized request
- real cEOS/EOS integration tests for:
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
2. large response handling for `show` and running-config reads
3. incomplete effective validation semantics in `validate-inventory`
4. insufficient real-device validation before release

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
