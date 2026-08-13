# EOS MCP Server — Design Overview

## Purpose

EOS MCP Server provides inventory-scoped, read-only access to Arista EOS devices through eAPI over HTTPS. It uses stdio MCP transport and never exposes configuration-changing operations.

## Tool surface

| Tool | Purpose |
| --- | --- |
| `eos_get_server_info` | Sanitized runtime, limits, and inventory summary |
| `eos_list_inventory` | Eligible hosts and groups |
| `eos_probe_devices` | Connectivity, authentication, and harmless command check |
| `eos_run_show` | Validated single-line `show` commands |
| `eos_show_logging` | Bounded logging retrieval |
| `eos_get_facts` | Fixed device facts |
| `eos_get_running_config` | Running configuration retrieval |

Local commands provide inventory validation, server-info output, and probing.

## Safety model

- The inventory is the sole target boundary; callers cannot supply addresses directly.
- HTTPS certificate validation is enabled by default.
- Passwords are supplied through a prefixed environment-variable reference or an inventory password field.
- EOS eligibility and `mcp_read_allowed` are evaluated from inherited inventory variables.
- A mixed or ineligible target fails as a whole; devices are never silently skipped.
- `eos_run_show` accepts only validated `show` commands. Control characters, shell metacharacters, and output modifiers are rejected.
- Group running-configuration requests require a section selector to keep responses bounded.
- Per-request and aggregate response-size limits, concurrency limits, and overall operation timeout protect the server and clients.

## Inventory

The server supports canonical Ansible-style YAML and a simplified YAML schema. Hosts must be explicitly marked with either `ansible_network_os: eos` or `mcp_platform: arista_eos`. Group membership is resolved deterministically; canonical group definitions under multiple parents are merged using Ansible-compatible host/child union and later-wins variable precedence.

## Operational behavior

Device-facing results use a common envelope with the requested target, resolved devices, a summary, and per-device outcomes. Failures that prevent a request from being safely run use stable machine-readable error codes. Raw eAPI payloads are opt-in for supported diagnostic tools.
