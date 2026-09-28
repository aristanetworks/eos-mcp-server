# EOS MCP Server Design Specification

## Scope

EOS MCP Server is an ESM TypeScript MCP server that provides inventory-scoped, read-only access to Arista EOS devices over eAPI (HTTPS). It runs over stdio MCP transport and is permanently read-only: the implementation exposes operational inspection and diagnostics only, and never exposes configuration-changing operations.

## Tool surface

| Tool | Purpose |
| --- | --- |
| `eos_get_server_info` | Sanitized runtime, limits, and inventory summary |
| `eos_list_inventory` | Eligible hosts and groups |
| `eos_probe_devices` | Connectivity, authentication, and harmless command check |
| `eos_run_show` | Validated single-line `show` commands |
| `eos_show_logging` | Bounded logging retrieval |
| `eos_get_facts` | Fixed device facts |
| `eos_get_running_config` | Running configuration retrieval, with a required section selector for groups |

Local CLI commands provide inventory validation, server-info output, and probing.

## Target boundary

- A target is exactly one inventory host or group name.
- Address, hostname, pattern, and ad-hoc targets are rejected.
- Host and group names use `^[A-Za-z0-9_.-]+$` and cannot collide.
- Group hosts are deduplicated and ordered alphabetically.
- Canonical inventories merge repeated group declarations with host/child union and later-wins variables.

## Inventory and policy

Canonical Ansible-style YAML and simplified YAML are supported. Structural keys are strict; arbitrary variables remain permitted. EOS eligibility requires `ansible_network_os: eos` or `mcp_platform: arista_eos`; conflicting declarations fail validation.

`mcp_read_allowed` defaults to `true` for eligible EOS hosts and follows inherited inventory variable precedence. Operational requests fail closed when any resolved host is ineligible or read-denied — a mixed or ineligible target fails as a whole, and devices are never silently skipped. The inventory is the only policy source.

## Connection security

- HTTPS is required.
- Certificate validation defaults to enabled; inventory may set an explicit lab override and server config may provide a CA bundle.
- A host resolves exactly one password source: `mcp_password_env` or `ansible_password`. The environment reference is preferred and must match a configured prefix (`EOS_MCP_` by default).
- Startup validation verifies connection data for all eligible hosts.

## Command safety

`eos_run_show` accepts only trimmed, single-line commands beginning with `show`. It rejects control characters, shell metacharacters, and CLI output modifiers. `eos_get_running_config.section` uses the same single-line restrictions. Enable mode is used only as needed to retrieve running configuration.

## Runtime controls

Read requests have configured per-device timeout, optional overall timeout, device concurrency, target-count, command-count, logging-message, and response-size limits. The overall timeout aborts in-flight requests and halts further scheduling. Device HTTP responses and final serialized tool results are size-limited.

## Result and error model

Device-facing tools return target metadata, resolved devices, summary counts, and per-device results. Request-level failures and known device failures use `AppError` machine-readable codes. Supported diagnostic tools expose raw eAPI payloads only through an explicit `include_raw` option.

## Compatibility and validation

The read surface is validated against cEOS 4.34.3M. EOS 4.20 is the documented minimum for supported read operations. Changes must preserve strict TypeScript checks and pass the unit, stdio smoke, and package-policy test suites.
