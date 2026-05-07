# EOS MCP Server — Design Overview

This document describes the design of a Model Context Protocol (MCP) server for Arista EOS devices. It is intended for network engineers and automation architects evaluating whether this tool fits their environment. We welcome feedback on the requirements, design tradeoffs, and security choices described here.

## What this server does

The EOS MCP server gives MCP-compatible AI assistants (Claude Code, Claude Desktop, Codex, and similar clients) structured, policy-controlled access to Arista EOS devices over eAPI (JSON-RPC over HTTPS). It connects via stdio and is driven entirely by an inventory file that defines which devices exist, how to reach them, and what operations are permitted.

The server provides two classes of operations:

- **Read tools** — run show commands, collect facts, retrieve running configuration, probe device readiness, and inspect the inventory.
- **Write tools** — preview, apply, and persist configuration changes through a multi-step workflow with signed artifacts and explicit confirmations.

## Design principles

The design strongly favors:

- **Security by default** — TLS validation on, write operations off, secrets never stored in config files.
- **Explicit trust boundaries** — the inventory is the authoritative source of scope, credentials, and policy. No ad hoc targets.
- **Fail-closed behavior** — mixed eligibility, policy conflicts, and ambiguous state produce errors rather than partial results.
- **Operational clarity** — structured error codes, consistent result envelopes, and sanitized introspection tools.
- **Small surface area** — a focused set of generic, command-oriented tools rather than a broad EOS domain model.

## Tool surface

### Read tools

| Tool | Purpose |
|------|---------|
| `eos_get_server_info` | Sanitized summary of server runtime, capabilities, limits, and inventory statistics |
| `eos_list_inventory` | Operational view of loaded hosts and groups with eligibility and policy status |
| `eos_probe_devices` | Verify device readiness by testing connectivity, authentication, and command execution |
| `eos_run_show` | Run one or more `show` commands against a host or group target |
| `eos_get_facts` | Collect a fixed core set of device facts (version, model, serial, etc.) |
| `eos_get_running_config` | Retrieve running configuration text, optionally filtered by section. Automatically enters enable mode. |

Key constraints:

- `eos_run_show` accepts only trimmed, single-line commands that are `show` or begin with `show `, and rejects CLI output modifiers or shell metacharacters before device contact.
- `eos_get_running_config` requires a trimmed, single-line `section` filter when targeting a group; section filters reject the same risky metacharacters as show commands.
- `eos_get_running_config` automatically enters enable mode via eAPI since `show running-config` requires privileged access.
- All read tools fail closed if the resolved target contains ineligible or read-denied hosts.

### Write tools

| Tool | Purpose |
|------|---------|
| `eos_preview_config` | Dry-run a configuration change and produce a signed preview artifact |
| `eos_apply_config` | Apply a previously previewed configuration change to running config |
| `eos_save_config` | Persist the current running config to startup config |

These tools are covered in detail in the [Write-path workflow](#write-path-workflow) section below.

### Local CLI commands

The server also ships local admin subcommands for operator use outside of MCP:

- `validate-inventory` — parse and validate inventory with optional startup-equivalent checks
- `print-server-info` — display runtime configuration summary
- `probe` — test device connectivity using the same logic as the MCP tool

## Inventory model

### Role of the inventory

The inventory file is the single source of truth for:

- **Target universe** — which devices and groups exist
- **Connection metadata** — endpoints, ports, credentials
- **Platform eligibility** — which devices are EOS
- **Policy** — per-target read and write permissions

Ad hoc out-of-inventory targets (raw IPs, hostnames not in the file) are never accepted. This constraint means the inventory is also the security boundary: if a device is not in the inventory, the server cannot be directed to contact it.

### Supported formats

The server accepts exactly one inventory file at startup, in either of two YAML schemas. The inventory is not watched for changes at runtime — to pick up edits, restart the server.


**Canonical Ansible-style YAML** — the `all.children` group hierarchy familiar from Ansible network automation:

```yaml
all:
  children:
    eos:
      vars:
        ansible_user: admin
        ansible_network_os: eos
        mcp_password_env: EOS_MCP_PASSWORD
      hosts:
        leaf1:
          ansible_host: 10.0.0.11
        leaf2:
          ansible_host: 10.0.0.12
```

**Simplified YAML** — a flatter format for environments that do not use Ansible:

```yaml
version: 1
vars:
  ansible_user: admin
  mcp_password_env: EOS_MCP_PASSWORD

hosts:
  leaf1:
    ansible_host: 10.0.0.11
    ansible_network_os: eos

groups:
  leafs:
    hosts: [leaf1]
```

### Structural validation

- Unknown structural keys are errors.
- Unknown keys inside `vars` blocks are allowed (forward compatibility).
- Duplicate YAML keys are hard errors.
- YAML anchors and aliases are allowed but validated after resolution.
- Host and group names must match `^[A-Za-z0-9_.-]+$` and must not collide with each other.
- Group `children` relationships must form an acyclic graph.

### Platform eligibility

EOS eligibility is determined by effective inherited variables:

- `ansible_network_os: eos`, or
- `mcp_platform: arista_eos`

Conflicting platform declarations on the same host are validation errors. Mixed inventories (EOS and non-EOS devices together) are supported — only EOS-eligible hosts are valid targets for this server.

### Targeting

- Each tool call accepts exactly one `target` string, which must be an inventory host name or group name.
- Targeting by IP address or `ansible_host` value is not allowed.
- Resolved hosts within a group are deduplicated and ordered alphabetically.

## Policy model

### Defaults

- `mcp_read_allowed`: **true** by default
- `mcp_write_allowed`: **false** by default

Policy is set exclusively through inventory variables. The server config does not inject read/write policy.

### Write policy is deny-dominant

`mcp_write_allowed` uses deny-dominant inheritance: if any ancestor group sets `mcp_write_allowed: false`, a child host or group cannot override it back to `true`. Such a contradiction is a startup validation error, not a silent precedence decision.

This means operators can lock out entire branches of the inventory from writes by setting the policy at a high-level group, with confidence that no nested override can weaken it.

### Fail-closed enforcement

For any operational tool call:

- If target resolution yields zero eligible EOS devices: error.
- If a group target mixes allowed and disallowed devices for the requested operation: error (not partial success).
- If a write target includes any device below the minimum supported EOS version: error.
- The special `all` group may be targeted by read tools but is **always forbidden** as a write target.

**Design tradeoff:** Failing the entire operation when a group contains a mix of allowed and disallowed hosts is deliberately strict. The alternative — executing against the allowed subset — risks operators not realizing that some devices were silently skipped. We chose to require operators to target explicitly allowed groups or individual hosts.

## Connection and authentication

### Transport

- HTTPS only; no HTTP fallback.
- TLS certificate validation is **on by default**.
- Per-host or per-group override via `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`) for lab and development environments.
- Optional global custom CA bundle via server config (`caFile`).
- No client-certificate authentication in the current design.

### Endpoint resolution

- Connection endpoint is `ansible_host` if present, otherwise the inventory host name.
- Fixed eAPI path: `/command-api`.
- Default port: `443`, overridable via `ansible_httpapi_port`.

### Credentials

- Username/password authentication only.
- Username from `ansible_user`.
- Password from exactly one of:
  - `mcp_password_env` — an environment variable **name** (preferred), or
  - `ansible_password` — a literal password value

If multiple password sources resolve for the same host, startup validation fails.

### Secret handling

`mcp_password_env` is a layer of indirection: the inventory stores the _name_ of an environment variable, not the password itself. This keeps secrets out of inventory files and config files.

Additional safeguards:

- Environment variable names must match an allowed prefix (default: `EOS_MCP_`).
- Missing referenced environment variables are startup validation errors.
- General environment variable interpolation is not supported — only the explicit `mcp_password_env` field reads from the environment.
- Every EOS-eligible host must have complete effective credentials at startup; missing credentials are not deferred to runtime.

**Design tradeoff:** Requiring all credentials to be present and valid at startup (rather than resolving them lazily at first use) means the server fails fast with a clear error message. The cost is that the operator must have all environment variables exported before starting the server, even for devices they may not immediately query.

## Write-path workflow

Configuration changes follow a deliberate multi-step workflow designed to prevent accidental or unreviewed changes.

### Step 1: Preview (`eos_preview_config`)

The operator (or AI assistant) submits a set of configuration commands or config text. The server:

1. Validates and normalizes the commands.
2. Resolves the target to a set of devices.
3. Executes a dry-run on each device (preferring config sessions).
4. Returns structured per-device preview results.
5. Returns a **signed preview artifact** — an opaque, HMAC-signed blob that captures the exact intended change.

The preview artifact is:

- Bound to the current server instance and inventory snapshot.
- Timestamped with a configurable maximum age.
- Invalidated by server restart.

### Step 2: Apply (`eos_apply_config`)

To apply the change, the caller must provide:

- The signed `preview_artifact` from the preview step.
- Explicit confirmation flags (`confirm: true`, plus `confirm_group_write: true` for group targets).
- Change metadata matching what was used during preview (`change_reason`, and optionally `ticket_id` / `change_id`).

The server re-validates the commands on each device at apply time — the prior preview never substitutes for apply-time validation. If the preview used config sessions but only direct-mode is available at apply time (a weaker execution path), the apply is rejected.

### Step 3: Save (`eos_save_config`)

`eos_save_config` is a separate, explicit action that persists the current running config to startup config. It requires its own confirmation flags (`confirm: true`, `confirm_persist_current_state: true`).

This is intentionally not bundled with apply: the operator should have a chance to verify the running-config change before deciding to persist it.

**Design tradeoff:** The preview-then-apply workflow adds friction compared to a single "push config" operation. This is intentional. In network automation, configuration changes to production devices benefit from an explicit review step, and the signed artifact ensures that what was reviewed is exactly what gets applied. The cost is two tool calls instead of one; the benefit is auditability and protection against stale or modified changes.

### Config input and validation

Write tools accept configuration as either:

- `commands` — an explicit list of command strings, or
- `config_text` — a block of configuration text (split on newlines, trimmed, blank lines and full-line comments removed)

Exactly one must be provided. The server validates commands against a denylist of dangerous or control-plane commands (e.g., reload, session management). The server owns all session and persistence mechanics — operators provide only the configuration intent.

### Execution mode

- **Config sessions** are preferred for both preview and apply.
- **Direct-config mode** (configure terminal) is available as a fallback but is **disabled by default**.
- Direct-config fallback must be explicitly enabled in the server config.
- If preview used sessions, apply cannot fall back to direct mode.

**Design tradeoff:** Config sessions provide atomic commit/rollback semantics and are the safer execution mode. Direct-config mode is available for devices or EOS versions that do not support sessions, but requiring explicit opt-in ensures operators are aware they are accepting weaker transactional guarantees.

## Concurrency and failure model

### Device fan-out

Group operations execute in parallel against resolved devices, with configurable limits:

- Device concurrency (how many devices are contacted simultaneously).
- Maximum read and write target counts.
- Maximum command counts per request.

### Write locking

- Read tools may run concurrently with no restrictions.
- Only **one write-path operation** may run at a time (across preview, apply, and save).
- A second concurrent write request is immediately rejected — there is no queue.
- Read operations remain available during an active write.

### Group write failure

- The full target set is resolved and pre-validated before execution begins.
- On the first device failure: the overall operation is marked failed, in-flight devices may finish, but no new devices are scheduled.
- There is **no cross-device rollback guarantee**. If three of five devices succeed before a failure on the fourth, the three successful devices retain their changes.

**Design tradeoff:** Cross-device rollback would require two-phase commit semantics that EOS config sessions do not natively support across devices. Rather than implementing a fragile orchestration layer, the server reports exactly which devices succeeded and which failed, leaving the operator to decide how to remediate. This is consistent with how most network automation tools handle multi-device changes.

### Cancellation and timeout

On cancellation or overall timeout during a write operation:

- No new devices are scheduled.
- In-flight device operations are allowed to finish.
- Uncommitted config sessions are aborted/discarded where possible.
- No rollback guarantees for already-applied direct-config changes.

Separate configurable timeouts exist for per-device read operations, per-device write operations, and overall operation duration. Overall read-operation timeout aborts in-flight eAPI requests and stops scheduling new devices. There are no automatic retries.

## Summary of key security choices

1. **Inventory as trust boundary** — no ad hoc targets, no runtime-supplied IPs.
2. **HTTPS only, TLS on by default** — cert validation disabled only through explicit inventory configuration.
3. **Secrets by reference** — passwords stored as environment variable names, not values; prefix-restricted.
4. **Startup credential validation** — all credentials verified at server start, not deferred to first use.
5. **Write operations off by default** — must be explicitly enabled at startup.
6. **Deny-dominant write policy** — ancestor denials cannot be overridden by descendants.
7. **`all` forbidden as a write target** — prevents accidentally pushing config to every device.
8. **Fail-closed on mixed targets** — no silent partial execution.
9. **Signed preview artifacts** — what was reviewed is what gets applied; bound to server instance and inventory.
10. **Apply cannot weaken execution mode** — if preview used config sessions, apply cannot fall back to direct mode.
11. **Separate save step** — persisting to startup config requires its own explicit confirmation.
12. **Global write lock** — only one write operation at a time; no queueing.
13. **No general env interpolation** — only the explicit `mcp_password_env` field reads from the environment.
14. **Show-only command validation** — `eos_run_show` rejects anything that does not begin with `show`.

## Feedback welcome

We are particularly interested in feedback on:

- **Inventory format** — Do the two supported schemas cover your environment? Would you need multi-file inventory support, dynamic inventory, or integration with an external source of truth?
- **Policy model** — Is deny-dominant write policy the right default? Are there cases where you would need a child group to re-enable writes that a parent disabled?
- **Credential handling** — Does the `mcp_password_env` indirection work for your secret management workflow? Would you need integration with vault systems or other secret backends?
- **Write-path workflow** — Is the preview/apply/save separation appropriate for your change management process? Is the signed-artifact approach helpful or overly complex for your use case?
- **Fail-closed behavior** — Are there scenarios where partial execution against a mixed group would be preferable to failing the entire operation?
- **Targeting model** — Is single-target-per-call sufficient, or would you need multi-target or pattern-based targeting?
