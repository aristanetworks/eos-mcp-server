# eos-mcp-server

Read-only MCP server for Arista EOS eAPI (JSON-RPC over HTTPS).

Phase 1 of this project intentionally ships a **read-only MVP**. The server can:

- introspect its own runtime and inventory
- list inventory hosts/groups
- probe EOS device readiness
- run `show` commands
- collect a fixed set of device facts
- retrieve running configuration

It cannot modify device configuration yet. Startup attempts to enable write mode are currently rejected.

## Current status

Implemented MCP tools:

- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_run_show`
- `eos_get_facts`
- `eos_get_running_config`

Implemented local CLI commands:

- `serve`
- `validate-inventory`
- `print-server-info`
- `probe`

## Requirements

- Node.js 20+
- Arista EOS devices reachable via eAPI over HTTPS
- Inventory in one of the supported YAML formats

## Install

### From source

```bash
npm install
npm run build
```

Run the built CLI directly:

```bash
node dist/index.js serve --inventory path/to/inventory.yml
```

### Install on PATH

After building, you can make the `eos-mcp-server` command available globally.

From the project directory:

```bash
npm install
npm run build
npm link
```

Or install directly from a local checkout without needing to be inside the directory:

```bash
npm install -g /absolute/path/to/eos-mcp-server
```

Either method puts `eos-mcp-server` on your `PATH`, so you can run:

```bash
eos-mcp-server serve --inventory path/to/inventory.yml
```

To uninstall later:

```bash
npm unlink -g eos-mcp-server
```

### Development mode

```bash
npm run dev -- serve --inventory path/to/inventory.yml
```

### Tests

```bash
npm test
npm run typecheck
```

## Quick start

1. Create an inventory.
2. Export a password environment variable.
3. Validate the inventory.
4. Probe a host or group.
5. Start the MCP server over stdio.

Example:

```bash
export EOS_MCP_PASSWORD='super-secret'

node dist/index.js validate-inventory --inventory inventory.yml
node dist/index.js probe --inventory inventory.yml --target leaf1
node dist/index.js serve --inventory inventory.yml
```

## Inventory formats

The server supports exactly one inventory file loaded at startup.

Supported formats:

- canonical Ansible-style YAML
- simplified YAML

### Canonical Ansible-style example

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

### Simplified YAML example

```yaml
version: 1
vars:
  ansible_user: admin
  mcp_password_env: EOS_MCP_PASSWORD

hosts:
  leaf1:
    ansible_host: 10.0.0.11
    ansible_network_os: eos
  leaf2:
    ansible_host: 10.0.0.12
    ansible_network_os: eos

groups:
  leafs:
    hosts: [leaf1, leaf2]
```

## Important inventory rules

- Targets must be **inventory host or group names**, not IP addresses.
- Host/group names must match `^[A-Za-z0-9_.-]+$`.
- Duplicate YAML keys are rejected.
- The simplified schema reserves `all`; do not define `groups.all` there.
- Group graphs must be acyclic.
- EOS eligibility comes from either:
  - `ansible_network_os: eos`
  - `mcp_platform: arista_eos`
- Read operations fail closed if the resolved target contains ineligible or read-denied hosts.

## Connection and authentication

### Supported connection fields

The read path currently uses these effective fields:

- `ansible_host` - device hostname/IP for HTTPS connection
- `ansible_httpapi_port` - optional eAPI port, default `443`
- `ansible_user` - username
- `mcp_password_env` - preferred password source, treated as an **environment variable name**
- `ansible_password` - literal password source
- `mcp_validate_certs` - optional boolean to disable TLS validation for a lab target; `ansible_httpapi_validate_certs` is also accepted as a fallback

### Password source rules

Exactly one password source must resolve per EOS host:

- `mcp_password_env`
- `ansible_password`

Do **not** set both.

If you use `mcp_password_env`, the value must be the **name of an environment variable**, not the password itself.

Correct:

```yaml
mcp_password_env: EOS_MCP_PASSWORD
```

Incorrect:

```yaml
mcp_password_env: admin
```

The default allowed env var prefix is `EOS_MCP_`, so names like `EOS_MCP_PASSWORD` work by default.

Example:

```bash
export EOS_MCP_PASSWORD='admin'
```

## TLS behavior

- HTTPS only
- certificate validation is **on by default**
- optional custom CA bundle via config file `caFile`
- per-target or inherited inventory override via `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`)

There is currently **no CLI `--insecure` flag**.

### Disable cert validation for a lab inventory

```yaml
all:
  children:
    eos:
      vars:
        ansible_user: admin
        ansible_network_os: eos
        mcp_password_env: EOS_MCP_PASSWORD
        mcp_validate_certs: false
      hosts:
        leaf1:
          ansible_host: 10.0.0.11
```

### Prefer a CA bundle when possible

Server config:

```yaml
inventory: inventory.yml
caFile: /path/to/ca.pem
```

## Server config file

A YAML config file is optional.

CLI flags override config-file values.

Example:

```yaml
version: 1
inventory: ./inventory.yml
actor: lab-user
readTimeoutMs: 10000
overallOperationTimeoutMs: 30000
deviceConcurrency: 5
maxReadTargets: 50
maxShowCommandsPerRequest: 5
secretEnvPrefixes:
  - EOS_MCP_
defaultConnection:
  ansibleUser: admin
  mcpPasswordEnv: EOS_MCP_PASSWORD
  mcpValidateCerts: false
```

Useful config fields for the read-only MVP:

- `inventory`
- `actor`
- `caFile`
- `readTimeoutMs`
- `overallOperationTimeoutMs`
- `deviceConcurrency`
- `maxReadTargets`
- `maxShowCommandsPerRequest`
- `secretEnvPrefixes`
- `defaultConnection.ansibleUser`
- `defaultConnection.ansibleHttpapiPort`
- `defaultConnection.mcpValidateCerts`
- `defaultConnection.mcpPasswordEnv`

### Read-only guardrail

These are reserved for future work and are currently rejected if set:

- `enableWrite`
- `allowDirectConfigFallback`
- CLI `--enable-write`
- CLI `--allow-direct-config-fallback`

## CLI usage

If no subcommand is provided, the CLI defaults to `serve`.

### `serve`

Start the MCP server over stdio.

```bash
node dist/index.js serve --inventory inventory.yml
node dist/index.js serve --config eos-mcp-server.yml
```

On startup, `serve` loads the inventory and validates startup connection requirements for EOS-eligible hosts.

### `validate-inventory`

Validate the inventory file.

Default behavior performs:

- inventory parsing and structural validation
- effective inventory validation
- startup-style connection validation for EOS-eligible hosts using the loaded config/default connection settings

Use `--inventory-only` to skip the startup connection checks.

```bash
node dist/index.js validate-inventory --inventory inventory.yml
node dist/index.js validate-inventory --inventory inventory.yml --json
node dist/index.js validate-inventory --inventory inventory.yml --inventory-only
node dist/index.js validate-inventory --config eos-mcp-server.yml
```

### `print-server-info`

Print the server's sanitized runtime/config summary.

```bash
node dist/index.js print-server-info --inventory inventory.yml
node dist/index.js print-server-info --config eos-mcp-server.yml --json
```

### `probe`

Probe a host or group target using the same logic as the MCP tool.

```bash
node dist/index.js probe --inventory inventory.yml --target leaf1
node dist/index.js probe --inventory inventory.yml --target leafs --json
```

Human-readable example output:

```text
Probe target: leaf1
Devices: 1/1 succeeded
- leaf1: success
```

## MCP tool reference

### `eos_get_server_info`

Returns a sanitized summary of server runtime, capabilities, limits, TLS/config posture, and inventory summary.

Input:

```json
{}
```

### `eos_list_inventory`

Returns a sanitized view of the loaded inventory.

Input:

```json
{
  "include_ineligible": false
}
```

### `eos_probe_devices`

Checks operational readiness for a host or group by contacting devices and running a harmless command.

Input:

```json
{
  "target": "leaf1"
}
```

### `eos_run_show`

Runs one or more `show` commands.

Rules:

- exactly one of `command` or `commands`
- every command must begin with `show`
- `output_format` is one of `auto`, `json`, `text`

Input examples:

```json
{
  "target": "leaf1",
  "command": "show version",
  "output_format": "auto"
}
```

```json
{
  "target": "leafs",
  "commands": ["show version", "show interfaces status"],
  "output_format": "json"
}
```

### `eos_get_facts`

Collects a small, fixed core facts set from `show version`.

Input:

```json
{
  "target": "leaf1",
  "include_raw": false
}
```

### `eos_get_running_config`

Returns running config text for a host target, or for a group target when `section` is provided.

Input examples:

```json
{
  "target": "leaf1"
}
```

```json
{
  "target": "leafs",
  "section": "router bgp"
}
```

## MCP client setup examples

### Generic stdio example

If you built the project locally:

```json
{
  "mcpServers": {
    "eos": {
      "command": "node",
      "args": [
        "/absolute/path/to/eos-mcp-server/dist/index.js",
        "serve",
        "--config",
        "/absolute/path/to/eos-mcp-server.yml"
      ]
    }
  }
}
```

If `eos-mcp-server` is installed on your `PATH`:

```json
{
  "mcpServers": {
    "eos": {
      "command": "eos-mcp-server",
      "args": ["serve", "--config", "/absolute/path/to/eos-mcp-server.yml"]
    }
  }
}
```

### Claude Code

Add the server to your project scope using the CLI:

```bash
claude mcp add eos -- node /absolute/path/to/eos-mcp-server/dist/index.js serve --config /absolute/path/to/eos-mcp-server.yml
```

Or if `eos-mcp-server` is on your `PATH`:

```bash
claude mcp add eos -- eos-mcp-server serve --config /absolute/path/to/eos-mcp-server.yml
```

Use `-s user` to install for all projects instead of just the current one:

```bash
claude mcp add -s user eos -- node /absolute/path/to/eos-mcp-server/dist/index.js serve --config /absolute/path/to/eos-mcp-server.yml
```

### Codex

Add to your project's `codex.json` (or `~/.codex/codex.json` for global):

```json
{
  "mcpServers": {
    "eos": {
      "command": "node",
      "args": [
        "/absolute/path/to/eos-mcp-server/dist/index.js",
        "serve",
        "--config",
        "/absolute/path/to/eos-mcp-server.yml"
      ]
    }
  }
}
```

Or if `eos-mcp-server` is on your `PATH`:

```json
{
  "mcpServers": {
    "eos": {
      "command": "eos-mcp-server",
      "args": ["serve", "--config", "/absolute/path/to/eos-mcp-server.yml"]
    }
  }
}
```

### Passing secrets to the MCP server

Prefer exporting secrets in the environment that launches the MCP client:

```bash
export EOS_MCP_PASSWORD='super-secret'
```

Some MCP clients also support per-server `env` blocks. Avoid committing secrets to client config files when possible.

## Common troubleshooting

### `Password env var ... does not match any allowed prefix`

`mcp_password_env` must contain an **environment variable name** like `EOS_MCP_PASSWORD`, not the password itself.

### `Password env var ... is not set`

Export the referenced environment variable before launching `probe` or `serve`.

### Certificate validation failure

Use one of:

- `caFile` in the server config to trust your lab CA
- `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`) in inventory for a lab/dev target

There is no CLI TLS-disable flag today.

### `Unknown inventory target ...`

Tool and CLI targets must be inventory names, not `ansible_host` IPs.

### Group running-config request failed without `section`

For `eos_get_running_config`, group targets require a `section` value.

### Policy denied when probing a device

Example:

```
eos-mcp-server probe --inventory clab/clab-testlab/ansible-inventory.yml --target clab-testlab-node1-1
Policy denied: target clab-testlab-node1-1 includes host(s) not permitted for read: clab-testlab-node1-1
```

You need to specify that the devices are marked as `ansible_network_os=eos` in your inventory.

## Design notes for the current MVP

- inventory is the trust boundary
- reads are fail-closed on ineligible or denied targets
- write-mode startup is intentionally blocked in Phase 1
- the current release target is a documented, test-backed read-only server

## Project docs

Additional design and planning docs in this repository:

- `DESIGN.md`
- `IMPLEMENTATION_PLAN.md`
- `CHECKPOINT.md`
