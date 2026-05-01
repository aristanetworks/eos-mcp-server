# EOS MCP Server Design Summary

## Overview

This document summarizes the agreed design for a TypeScript MCP server for Arista EOS eAPI (JSON-RPC over HTTPS). The server is intended to work well with Claude Code, Claude Desktop, Codex, and similar MCP clients.

The design strongly favors:
- security by default
- explicit trust boundaries
- fail-closed behavior
- operational clarity over convenience
- a small, high-quality v1 surface area

## Primary Goals

- Provide safe read and config-management access to Arista EOS devices through MCP.
- Use an inventory file as the authoritative source of devices, groups, scope, and policy.
- Work well in local stdio-based MCP client environments.
- Keep the first version generic and command-oriented rather than over-modeling EOS.

## Core Product Shape

- **Language/runtime:** TypeScript on Node 20+
- **Packaging:** npm package with a CLI entrypoint
- **Package format:** ESM only
- **Repo structure:** single package for v1, with internal module boundaries
- **Package manager:** pnpm
- **MCP transport:** stdio only in v1
- **MCP implementation:** official TypeScript MCP SDK, wrapped in a thin internal abstraction

## Release Phases

### Phase 1: read-only MVP
The first shippable release is intentionally limited to safe read-only operations:
- inventory loading and validation
- target resolution and read-policy enforcement
- inventory listing and server introspection
- connectivity probing
- `show` command execution
- fixed-schema fact gathering
- running-config retrieval

Phase 1 runs in read-only mode only. The current code rejects `enableWrite` and `allowDirectConfigFallback` startup options so the server cannot advertise write support before those paths exist.

### Phase 2: write-path foundation and tools
A later phase may add:
- write-path runtime locking/orchestration
- config normalization/validation
- signed preview artifacts
- `eos_preview_config`
- `eos_apply_config`
- `eos_save_config`
- structured audit logging for config change workflows

## High-Level Safety Model

- **Phase 1 ships as read-only only.**
- Startup attempts to enable writes are rejected in the current MVP.
- Only read/admin behaviors are in scope for the first release.
- Future write-path tools remain planned, but are deferred to a later phase.
- `eos_preview_config` is treated as part of the write workflow, not as a general read tool.

## Tool Surface

### Phase 1: read-only MVP tools
- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_get_facts`
- `eos_run_show`
- `eos_get_running_config`

### Phase 2: planned write-path tools
- `eos_preview_config`
- `eos_apply_config`
- `eos_save_config`

### Local admin subcommands in Phase 1
- `validate-inventory`
- `print-server-info`
- `probe`

No separate local non-MCP write interface is planned.

## Naming

- MCP tools use flat names with an `eos_` prefix.
- Example names:
  - `eos_get_server_info`
  - `eos_list_inventory`
  - `eos_probe_devices`
  - `eos_get_facts`
  - `eos_run_show`
  - `eos_get_running_config`
  - `eos_preview_config`
  - `eos_apply_config`
  - `eos_save_config`

## Inventory Model

### Inventory role
The inventory is the authoritative source of:
- target universe
- groups
- connection metadata
- platform eligibility
- per-target read/write policy

Ad hoc out-of-inventory targets are not allowed.

### Supported inventory formats
V1 supports exactly one inventory file loaded at startup.

Supported schema families:
1. **Canonical Ansible-style YAML**
2. **Simplified YAML schema**

No inventory directories, include graphs, or multi-file merge behavior in v1.

### Simplified inventory schema
```yaml
version: 1   # optional
vars:
  ansible_user: admin

hosts:
  leaf1:
    ansible_host: 10.0.0.11
    ansible_network_os: eos

groups:
  leafs:
    vars:
      mcp_write_allowed: true
    hosts: [leaf1]
    children: []
```

Rules:
- top-level `vars` allowed
- host vars live directly on each host object
- group objects may contain only:
  - `vars`
  - `hosts`
  - `children`
- `all` is implicit/reserved in the simplified schema and may not appear in `groups`
- group `children` relationships must form an acyclic graph

### Structural validation rules
- Strict structural validation
- Flexible variable maps
- Unknown structural keys are errors
- Unknown keys inside `vars` are allowed
- Duplicate YAML keys are hard errors
- YAML anchors/aliases/merge keys are allowed, but validated after resolution

### Naming rules
- Host and group names must not collide
- Names are case-sensitive
- Names must match a safe identifier pattern:
  - `^[A-Za-z0-9_.-]+$`

### Targeting rules
- A tool accepts exactly one `target` string
- `target` must be an inventory host name or group name
- Targeting by `ansible_host`/IP is not allowed
- Resolved hosts are deduplicated automatically
- Final resolved host order is alphabetical by inventory host name

### Mixed inventories
- Mixed inventories are allowed
- Only explicitly EOS hosts are valid targets for this server
- EOS eligibility may come from effective inherited config via either:
  - `ansible_network_os: eos`
  - `mcp_platform: arista_eos`
- Conflicting platform declarations are validation errors
- Direct or group targets that include non-EOS hosts fail closed for operational tools

## Policy Model

### Policy source of truth
- Per-target policy comes from inventory only
- Server config does **not** inject `mcp_read_allowed` or `mcp_write_allowed`

### Default policy
- `mcp_read_allowed: true` by default
- `mcp_write_allowed: false` by default

### Permission semantics
- `mcp_read_allowed` follows normal inheritance precedence
- `mcp_write_allowed` is **deny-dominant**
- If an ancestor sets `mcp_write_allowed: false`, a descendant may not explicitly set it back to `true`
- Such a contradiction is a startup validation error

### Fail-closed behavior
For operational tools:
- If target resolution yields zero eligible EOS devices: request-level error
- If a group target mixes allowed and disallowed devices for the requested action: fail closed
- If a write target includes any device below the minimum supported EOS version: fail closed
- If any device in a group would require direct fallback while fallback is disabled: fail closed

### Special `all` group rule
- `all` may be targeted by read-side tools
- `all` may **not** be targeted by write-path tools

## Connection and Authentication Model

### Transport to devices
- HTTPS only
- Default TLS validation on
- Per-host/group `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`) allowed for lab/dev
- Optional global custom CA bundle/path in server config
- No client-certificate auth in v1

### Endpoint rules
- Fixed path: `/command-api`
- Default port: `443`
- Port override via `ansible_httpapi_port`
- Connection endpoint is:
  - `ansible_host` if present
  - otherwise inventory host name

### Authentication
- Username/password only in v1
- Assume supplied credentials already have required privilege
- No explicit enable-mode flow

### Credential fields
- Username: `ansible_user`
- Password source: exactly one of
  - `mcp_password_env` (preferred)
  - `ansible_password`
- If multiple password sources are present in the effective config, startup validation fails

### Server config defaults
Server config may provide connection defaults such as:
- default username
- default port
- default TLS validation policy
- default password env reference

But not:
- literal default passwords
- per-target policy defaults

### Secret reference rules
- Env-var secret references are allowed only through explicit fields like `mcp_password_env`
- General env interpolation is not supported
- Env var names must match an allowed prefix policy
- Missing referenced secret env vars are startup validation errors
- Every EOS-eligible host must have complete effective credentials at startup

## Server Config

- Optional YAML config file
- CLI flags override config file
- Relative paths in config are resolved relative to the config file directory
- Relative CLI paths resolve from current working directory
- Optional `version: 1` supported

## Read Tool Semantics

### `eos_run_show`
- Accepts host or group target
- Accepts one or more commands
- Commands must start with `show`
- `output_format` supports:
  - `auto`
  - `json`
  - `text`
- `auto` prefers structured output, falls back to text
- `json` fails if structured output is unavailable
- Results are normalized/sanitized by default
- Raw payloads are optional via explicit flag

### `eos_get_facts`
- Accepts host or group target
- Returns a fixed core schema plus optional raw/debug supplement
- Intended as a stable convenience tool, not a full EOS model

### `eos_get_running_config`
- Read permission required
- Device AAA ultimately decides access at execution time
- Returns config text inside a structured wrapper
- `section` is a raw EOS section selector string
- Single-host target may request full config or a section
- Group target is allowed only if `section` is provided

### `eos_probe_devices`
- Requires read permission
- Verifies actual operational readiness, not just TCP connectivity
- Includes harmless command execution (for example `show version`)

### `eos_list_inventory`
- Sanitized operational view
- Default view focuses on EOS-eligible/actionable hosts
- Optional flag may include ineligible hosts with reasons
- Shows all groups by default, with metadata such as actionable status and eligible counts

## Write Tool Semantics

### General write path
- Low-level generic config tools only in v1
- No structured write helpers in v1
- Same normalized command list applied to every device in a group target
- No per-device templating in v1

### Accepted config inputs
- Either:
  - `commands: string[]`
  - `config_text: string`
- Exactly one must be provided
- `config_text` normalization:
  - split on newlines
  - trim each line
  - drop blank lines
  - drop full-line `#` comments only
  - preserve line order
- No inline comment stripping
- No indentation-aware parsing

### Write command validation
- Moderate validation
- Reject obviously dangerous commands and control commands
- Server owns all session/control/persistence mechanics
- Built-in denylist plus startup-configured extra deny patterns

### Execution engine
- Prefer config sessions
- Direct-config fallback is disabled by default
- Direct fallback allowed only via startup config
- Preview/apply must fail closed if the allowed execution path cannot be satisfied
- Apply may not use a weaker execution mode than preview established

### Intra-device behavior
- Commands execute in order
- Stop on first command failure
- In session mode, abort/discard before commit when possible
- In direct mode, report that prior commands may already have changed running config

### Persistence
- `eos_apply_config` changes running config only
- `eos_save_config` persists current running-config as a separate explicit action
- `eos_save_config` persists current device state, not specifically MCP-originated changes
- No preview artifact required for save

## Stateless Preview/Apply Contract

### Core model
- Server is fully stateless across tool calls
- `eos_preview_config` and `eos_apply_config` are separate calls
- `eos_apply_config` uses only the signed preview artifact as the authoritative source of intended change

### Preview artifact
`eos_preview_config` returns:
- explicit structured fields for transparency
- normalized command list
- resolved ordered device list
- per-device preview results
- per-device safety metadata
- signed authoritative `preview_artifact`

The artifact is:
- HMAC/signed
- bound to the current server instance
- bound to the current inventory snapshot
- timestamped
- subject to a startup-configured max age
- invalid after restart

### Apply requirements
`eos_apply_config` requires:
- `preview_artifact`
- confirmations
- core matching change metadata
- optional drift-check artifacts if used

`eos_apply_config` always restages/revalidates on the device. Prior preview never substitutes for apply-time validation.

### Drift detection
- Optional in v1
- Uses best-effort baseline fingerprints with explicit scope metadata

### Preview fidelity rules
- Preview is best-effort but explicit about fidelity
- If preview was low-fidelity, apply requires extra acknowledgement
- If apply would be weaker than preview, apply is rejected

## Confirmation and Change Metadata

### Confirmations
Write tools require explicit confirmation fields.

- `eos_apply_config`:
  - `confirm: true`
  - `confirm_group_write: true` for group targets
  - extra acknowledgement if preview was low-fidelity
- `eos_save_config`:
  - `confirm: true`
  - `confirm_persist_current_state: true`
  - `confirm_group_write: true` for group targets

### Change metadata
Write-path requests require structured change metadata:
- `change_reason` required
- `ticket_id` optional
- `change_id` optional

Preview/apply binding rules:
- `change_reason` must match
- `ticket_id`/`change_id`, if present, must match
- apply may add extra audit-only metadata

## Concurrency, Failure, and Cancellation

### Device fan-out
- Group operations run in parallel with a fixed startup-configured concurrency limit
- Write and read target counts have startup-configured maximums
- Read and write command counts have startup-configured maximums

### Global operation locking
- Read tools may run concurrently
- Only one write-path operation may run at a time
- Write-path operations include:
  - `eos_preview_config`
  - `eos_apply_config`
  - `eos_save_config`
- A second write request is rejected immediately with a request-level error
- Reads remain allowed during writes

### Group write failure model
- Full target set resolved and prevalidated before execution
- On first device failure:
  - overall operation marked failed
  - in-flight devices may finish
  - no new devices are scheduled
- No cross-device rollback guarantee

### Cancellation and overall timeout
On cancellation or overall timeout during a write-path operation:
- stop scheduling new devices
- let in-flight work finish
- abort/discard uncommitted config sessions where possible
- no rollback guarantees for already-applied direct config

## Timeouts and Retries

- No automatic retries
- Separate startup-configured read and write timeouts
- Both per-device timeout and overall operation timeout

## Response Sizes and Limits

- Enforce both per-device/per-command and aggregate response-size limits
- Prefer explicit narrowing/chunking guidance rather than silent truncation
- `eos_get_running_config` especially encourages section-filtered access

## Error Model and Result Shape

### Error model
- Request-level problems fail the tool call
- Device/runtime failures are returned as structured per-device results
- Stable machine-readable error codes are required for major error classes
- Human-readable messages and structured context accompany codes

### Result envelope
All device-contacting tools share a common top-level result envelope, including:
- `target`
- `target_type`
- `resolved_devices`
- `summary`
- `results[]`

Per-device results include:
- `inventory_hostname`
- `resolved_endpoint`
- `device_hostname` when known
- `status`
- `error_code` and `message` when applicable
- tool-specific payload

### Common statuses
Representative statuses include:
- `success_changed`
- `success_no_change`
- `failed`
- `not_started`
- cancellation-related variants as needed

## Logging and Audit

- Structured audit logs are enabled
- Default sink is stderr
- Optional file sink supported
- Log local/server process identity plus optional startup-supplied actor label
- Log denied write attempts
- Do not log secrets
- Logging of normalized write command bodies is configurable and off by default

## `eos_get_server_info`

Returns a high-detail but sanitized summary, including:
- server version
- runtime mode
- current write lock state
- supported inventory schemas
- configured limits
- timeout defaults
- preview artifact and preview age rules
- direct fallback enabled/disabled
- custom CA configured yes/no
- sanitized inventory identifier
- inventory statistics
- minimum supported EOS version policy status

## Validation and Introspection CLI

### `validate-inventory`
Supports:
- full effective validation (preferred/default operator path)
- inventory-only mode
- human-readable output by default
- `--json` structured output
- non-zero exit on failure

### `probe`
- Uses the same underlying probe logic as the MCP tool
- Human-readable output by default
- `--json` supported
- Still limited to inventory-defined targets only

## Version Compatibility

- The server will document a minimum supported EOS version before release
- Exact minimum version remains open until integration testing is complete
- Reads may proceed best-effort on older EOS
- Write-path tools fail closed below the supported minimum

## Testing Strategy

- Unit tests for:
  - inventory parsing
  - normalization
  - inheritance/conflict detection
  - target resolution
  - policy enforcement
  - command normalization/validation
  - request/artifact generation
- Integration tests against a real EOS target
- Not a large version matrix in v1

## Choices That Especially Emphasize Security and Operational Strictness

The following decisions most strongly shape the security posture:

1. **Phase 1 ships read-only only; write enablement is rejected until later work lands**
2. **Inventory is the authoritative scope and policy boundary**
3. **No ad hoc targets, no arbitrary inventory path per tool call**
4. **Write tools hidden entirely unless enabled**
5. **Preview treated as part of the write path, not general read access**
6. **`mcp_write_allowed` deny-dominant and contradiction-checked**
7. **Fail-closed behavior for mixed eligibility and incompatible group targets**
8. **`all` forbidden as a write target**
9. **HTTPS only, TLS validation on by default**
10. **Explicit secret env references with allowed-prefix restrictions**
11. **Strict startup validation for all EOS-eligible hosts**
12. **Strict schema validation with unknown fields rejected**
13. **Signed stateless preview artifacts bound to server instance and inventory snapshot**
14. **Preview max age and restart invalidation**
15. **Apply cannot be weaker than preview**
16. **Apply always revalidates on-device**
17. **Direct-config fallback disabled by default**
18. **Global serialization of write-path operations**
19. **No queueing of overlapping writes**
20. **Strong write confirmations and required change metadata**
21. **Separate explicit save step with additional acknowledgement of persisting current state**
22. **Stable machine-readable error codes and shared result envelopes**
23. **No general env interpolation in config files**
24. **Strict duplicate-key errors in YAML**
25. **No local standalone write CLI in v1**

## Current Phase 1 Gaps

The current implementation is strong enough to target a read-only MVP, but the following items remain the main gaps to close or explicitly accept before release:
- add operator-facing package documentation (`README.md`) with inventory examples, secret-env usage, TLS guidance, and MCP client launch examples
- make `validate-inventory`'s default/effective mode truly distinct from `inventory-only`; today it does not yet perform startup-equivalent config/default-connection/secret validation
- enforce response-size limits and explicit narrowing guidance for large `show`, facts, and running-config responses
- tighten `eos_run_show` output shaping so sanitized default output is clearly separated from any optional raw payload pass-through
- finish real cEOS/EOS integration validation and choose/document a minimum supported EOS version for the read path
- polish shared request-level error taxonomy and operator-facing diagnostics for common inventory/auth/TLS failures

## Remaining Open Items

These are intentionally deferred rather than undecided:
- exact minimum supported EOS version (to be chosen after integration testing)
- concrete default values for timeouts, concurrency, target-count limits, command-count limits, and preview max age
- exact built-in denylist contents (policy direction is set, list still to be codified)
- exact fact fields included in the v1 fixed core schema after testing command availability

## Recommended Implementation Order From Current State

### Phase 1 completion order
1. Package/operator documentation for the read-only MVP
2. `validate-inventory` effective-mode hardening
3. response-size limits and narrowing guidance for read tools
4. `eos_run_show` output-shaping cleanup
5. real EOS/cEOS integration testing and minimum-version decision
6. release packaging and MCP client setup examples

### Phase 2 order
1. global write lock / runtime orchestration
2. config command normalization and validation
3. `eos_preview_config`
4. `eos_apply_config`
5. `eos_save_config`
6. structured audit logging for write workflows
