# EOS MCP Server — Design Overview

This document describes the design of a Model Context Protocol (MCP) server for Arista EOS devices. It is intended for network engineers and automation architects evaluating whether this tool fits their environment. We welcome feedback on the requirements, design tradeoffs, and security choices described here.

## What this server does

The EOS MCP server gives MCP-compatible AI assistants (Claude Code, Claude Desktop, Codex, and similar clients) structured, policy-controlled access to Arista EOS devices over eAPI (JSON-RPC over HTTPS). It connects via stdio and is driven entirely by an inventory file that defines which devices exist, how to reach them, and what operations are permitted.

The server provides two classes of operations:

- **Read tools** — run show commands, collect facts, retrieve running configuration, probe device readiness, and inspect the inventory.
- **Write tools** (planned) — preview, apply, and persist configuration changes through a multi-step workflow with signed artifacts and explicit confirmations.

The write path is designed but still under consideration.

## Design principles

- **Security by default** — TLS validation on, write operations off, secrets never stored in config files.
- **Explicit trust boundaries** — the inventory is the authoritative source of scope, credentials, and policy. No ad hoc targets.
- **Fail-closed behavior** — mixed eligibility, policy conflicts, and ambiguous state produce errors rather than partial results.
- **Operational clarity** — structured error codes, consistent result envelopes, and sanitized introspection tools.
- **Small surface area** — a focused set of generic, command-oriented tools rather than a broad EOS domain model.

## Tool surface

### Read tools

| Tool                     | Purpose                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `eos_get_server_info`    | Sanitized summary of server runtime, capabilities, limits, and inventory statistics    |
| `eos_list_inventory`     | Operational view of loaded hosts and groups with eligibility and policy status         |
| `eos_probe_devices`      | Verify device readiness by testing connectivity, authentication, and command execution |
| `eos_run_show`           | Run one or more `show` commands against a host or group target                         |
| `eos_show_logging`       | Retrieve bounded logging output using a minimum severity threshold and message count    |
| `eos_get_facts`          | Collect a fixed core set of device facts (version, model, serial, etc.)                |
| `eos_get_running_config` | Retrieve running configuration text, optionally filtered by section                    |

`eos_run_show` accepts only commands that begin with `show` and rejects shell metacharacters and CLI output modifiers before contacting the device. `eos_show_logging` is a token-conscious convenience wrapper around `show logging threshold <severity> <count>` and returns unparsed text. `eos_get_running_config` requires a section filter when targeting a group and automatically enters enable mode.

All read tools fail closed if the resolved target contains ineligible or read-denied hosts.

### Write tools (planned)

This will require some thought if we want to even expose write funcitons or just keep it all read-only.

| Tool                 | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `eos_preview_config` | Dry-run a configuration change and produce a signed preview artifact |
| `eos_apply_config`   | Apply a previously previewed configuration change to running config  |
| `eos_save_config`    | Persist the current running config to startup config                 |

These tools are covered in the [Write-path workflow](#write-path-workflow) section below.

### CLI commands

The server also ships CLI subcommands for operator use outside of MCP:

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
          ansible_host: 192.0.2.11
        leaf2:
          ansible_host: 192.0.2.12
```

**Simplified YAML** — a flatter format for environments that do not use Ansible:

```yaml
version: 1
vars:
  ansible_user: admin
  mcp_password_env: EOS_MCP_PASSWORD

hosts:
  leaf1:
    ansible_host: 192.0.2.11
    ansible_network_os: eos

groups:
  leafs:
    hosts: [leaf1]
```

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

- If target resolution yields zero eligible EOS devices: error.
- If a group target mixes allowed and disallowed devices for the requested operation: error (not partial success).
- The special `all` group may be targeted by read tools but is **always forbidden** as a write target.

**Design tradeoff:** Failing the entire operation when a group contains a mix of allowed and disallowed hosts is deliberately strict. The alternative — executing against the allowed subset — risks operators not realizing that some devices were silently skipped. We chose to require operators to target explicitly allowed groups or individual hosts.

## Connection and authentication

### Transport

- HTTPS only; no HTTP fallback.
- TLS certificate validation is **on by default**.
- Per-host or per-group override via `mcp_validate_certs: false` for lab and development environments.
- Optional global custom CA bundle via server config.
- No client-certificate authentication in the current design.

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

## Write-path workflow (TBD)

> The write path described below is designed but not yet implemented. The current release is read-only.

Configuration changes follow a deliberate multi-step workflow designed to prevent accidental or unreviewed changes.

### Step 1: Preview

The operator (or AI assistant) submits a set of configuration commands. The server validates and normalizes them, executes a dry-run on each target device (preferring config sessions), and returns structured per-device preview results along with a **signed preview artifact** — an opaque, HMAC-signed blob that captures the exact intended change, bound to the current server instance and inventory snapshot.

### Step 2: Apply

To apply the change, the caller must provide the signed preview artifact and explicit confirmation flags. The server re-validates the commands on each device at apply time — the prior preview never substitutes for apply-time validation. If the preview used config sessions but only direct-mode is available at apply time (a weaker execution path), the apply is rejected.

### Step 3: Save

Persisting the running config to startup config is a separate, explicit action with its own confirmation flags. This is intentionally not bundled with apply: the operator should have a chance to verify the running-config change before deciding to persist it.

**Design tradeoff:** The preview-then-apply workflow adds friction compared to a single "push config" operation. This is intentional. In network automation, configuration changes to production devices benefit from an explicit review step, and the signed artifact ensures that what was reviewed is exactly what gets applied. The cost is two tool calls instead of one; the benefit is auditability and protection against stale or modified changes.

### Execution mode

- **Config sessions** are preferred for both preview and apply (atomic commit/rollback).
- **Direct-config mode** (configure terminal) is available as a fallback but is **disabled by default** and requires explicit opt-in.
- If preview used sessions, apply cannot fall back to direct mode.

**Design tradeoff:** Config sessions provide atomic commit/rollback semantics and are the safer execution mode. Direct-config mode is available for devices or EOS versions that do not support sessions, but requiring explicit opt-in ensures operators are aware they are accepting weaker transactional guarantees.

## Concurrency and failure model

Group operations execute in parallel against resolved devices, with configurable limits on device concurrency, maximum target counts, and command counts per request.

- Read tools may run concurrently with no restrictions.
- Only **one write-path operation** may run at a time — a second concurrent write request is immediately rejected (no queue). Read operations remain available during an active write.
- On the first device failure in a group write: the overall operation is marked failed and no new devices are scheduled, but there is **no cross-device rollback guarantee**.

**Design tradeoff:** Cross-device rollback would require two-phase commit semantics that EOS config sessions do not natively support across devices. Rather than implementing a fragile orchestration layer, the server reports exactly which devices succeeded and which failed, leaving the operator to decide how to remediate. This is consistent with how most network automation tools handle multi-device changes.

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
- **Credential handling** — Does the `mcp_password_env` indirection work for your secret management workflow? Would you need integration with vault systems or other secret backends?
- **Fail-closed behavior** — Are there scenarios where partial execution against a mixed group would be preferable to failing the entire operation?
- **Targeting model** — Is single-target-per-call sufficient, or would you need multi-target or pattern-based targeting?
- **Language/packaging choice** — Is typescript/node/npm acceptable or is that a challenge operationally?
