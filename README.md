# eos-mcp-server BETA

**Note: this project is currently in BETA**
**Note: Support for this open sourced project is _best effort_, it is not currently supported by Arista TAC**

Read-only MCP server for Arista EOS eAPI (JSON-RPC over HTTPS).

This server provides a set of **read-only** tools. The server can:

- introspect its own runtime and inventory
- list inventory hosts/groups
- probe EOS device readiness
- run `show` commands
- retrieve bounded logging output for troubleshooting
- collect a fixed set of device facts
- retrieve running configuration

It never exposes configuration-changing operations.

Please be cautious when prompting, there have been occasions where the LLM will go around the MCP server and try to find a way to make config changes through other means. As a best practice, use AAA and restrict the access of the authentication used.

## Current status

Implemented MCP tools:

- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_run_show`
- `eos_show_logging`
- `eos_get_facts`
- `eos_get_running_config`

Implemented local CLI commands:

- `serve`
- `validate-inventory`
- `print-server-info`
- `probe`

## Requirements

- Node.js 24+
- Arista EOS devices reachable via eAPI over HTTPS
- EOS 4.20 or later (read-path tested against cEOS 4.34.3M)
- Inventory in one of the supported YAML formats

## Install and get started

1. Download the `eos-mcp-server-<version>.tgz` asset from the [latest GitHub release](https://github.com/aristanetworks/eos-mcp-server/releases/latest).
2. Install the downloaded package globally. Replace the filename with the release you downloaded:

   ```bash
   npm install -g ./eos-mcp-server-<version>.tgz
   ```

3. Confirm that the command is available:

   ```bash
   eos-mcp-server --help
   ```

The global install places `eos-mcp-server` on your `PATH`. To remove it later:

```bash
npm uninstall -g eos-mcp-server
```

Next, create an inventory, provide the device password, and validate connectivity:

```bash
export EOS_MCP_PASSWORD='replace-with-device-password'

eos-mcp-server validate-inventory --inventory inventory.yml
eos-mcp-server probe --inventory inventory.yml --target leaf1
```

See [Quickstart: eos-mcp-server with Claude Code](docs/QUICKSTART.md) for a complete inventory example and MCP client setup. For building or contributing from source, see the [developer workflow](docs/DEVELOPMENT.md).

## Inventory formats

The server supports exactly one inventory file loaded at startup. The inventory is not watched for changes — to pick up inventory edits, restart the server. Most MCP clients will do this automatically when you restart the client or re-launch the MCP connection. For Claude code quitting and starting a new session will work.

Supported formats:

- canonical Ansible-style YAML
- simplified YAML

Canonical inventories must have `all` as the only top-level key. Simplified inventories may use only `version`, `vars`, `hosts`, and `groups` at the top level. Unknown structural keys are rejected; unknown keys inside `vars` remain allowed.

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
          ansible_host: 192.0.2.11
        leaf2:
          ansible_host: 192.0.2.12
```

### Simplified YAML example

```yaml
version: 1
vars:
  ansible_user: admin
  mcp_password_env: EOS_MCP_PASSWORD

hosts:
  leaf1:
    ansible_host: 192.0.2.11
    ansible_network_os: eos
  leaf2:
    ansible_host: 192.0.2.12
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
export EOS_MCP_PASSWORD='replace-with-device-password'
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
          ansible_host: 192.0.2.11
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
maxLoggingMessagesPerRequest: 1000
maxResponseSizeBytes: 1048576
secretEnvPrefixes:
  - EOS_MCP_
defaultConnection:
  ansibleUser: admin
  mcpPasswordEnv: EOS_MCP_PASSWORD
  mcpValidateCerts: false
```

Supported config fields:

- `inventory`
- `actor`
- `caFile`
- `readTimeoutMs`
- `overallOperationTimeoutMs`
- `deviceConcurrency`
- `maxReadTargets`
- `maxShowCommandsPerRequest`
- `maxLoggingMessagesPerRequest`
- `maxResponseSizeBytes`
- `secretEnvPrefixes`
- `defaultConnection.ansibleUser`
- `defaultConnection.ansibleHttpapiPort`
- `defaultConnection.mcpValidateCerts`
- `defaultConnection.mcpPasswordEnv`

`readTimeoutMs` applies to each device eAPI request. `overallOperationTimeoutMs`, when set, bounds the whole tool call and aborts in-flight device requests once the limit is reached. `maxLoggingMessagesPerRequest` caps `eos_show_logging.message_count` and defaults to 1000. `maxResponseSizeBytes` limits both the buffered HTTP response from each device and the final serialized read-tool result.

`defaultConnection.mcpPasswordEnv` is a fallback password source. A host or inherited inventory value for `mcp_password_env` or `ansible_password` overrides it. Setting both `mcp_password_env` and `ansible_password` for the same host remains invalid.

## CLI usage

If no subcommand is provided, the CLI defaults to `serve`.

```bash
node dist/index.js --version
node dist/index.js --help
```

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
  "target": "leaf1",
  "include_raw": false
}
```

### `eos_run_show`

Runs one or more `show` commands.

Rules:

- exactly one of `command` or `commands`
- every command is trimmed, must be a single line, and must be `show` or begin with `show`
- commands with CLI output modifiers or shell metacharacters such as `|`, `>`, `<`, `;`, `&`, backticks, or `$` are rejected before device contact
- `output_format` is one of `auto`, `json`, `text`
- `include_raw` optionally attaches each command's raw eAPI result entry as `raw_entry` inside `command_results`

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
  "output_format": "json",
  "include_raw": false
}
```

### `eos_show_logging`

Retrieves bounded EOS logging output for a host or group target. The tool always uses text output and generates `show logging threshold <minimum_severity> <message_count>`. `minimum_severity` is a threshold, so `warnings` includes warning and more urgent log messages. Defaults are `minimum_severity: "warnings"` and `message_count: 100`; `message_count` is capped by `maxLoggingMessagesPerRequest`.

Input example:

```json
{
  "target": "leaf1",
  "minimum_severity": "warnings",
  "message_count": 100
}
```

Allowed severities are `emergencies`, `alerts`, `critical`, `errors`, `warnings`, `notifications`, `informational`, and `debugging`.

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

Returns running config text for a host target, or for a group target when `section` is provided. Automatically enters enable mode via eAPI since `show running-config` requires privileged access. `section` is trimmed and must be a single-line EOS section selector without CLI output modifiers or shell metacharacters.

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

### Command or section rejected as invalid

`eos_run_show` accepts only single-line `show` commands. `eos_get_running_config.section` must also be a single-line selector. Newlines, other control characters, CLI output modifiers, and shell metacharacters are rejected before any device contact.

### Response too large

Read tools are bounded by `maxResponseSizeBytes`. The server rejects oversized device HTTP responses before buffering them fully, and also rejects oversized aggregate tool results with narrowing guidance. For `eos_show_logging`, reduce `message_count`, target fewer devices, or raise `minimum_severity`.

### Policy denied when probing a device

Example:

```
eos-mcp-server probe --inventory clab/clab-testlab/ansible-inventory.yml --target clab-testlab-node1-1
Policy denied: target clab-testlab-node1-1 includes host(s) not permitted for read: clab-testlab-node1-1
```

You need to specify that the devices are marked as `ansible_network_os=eos` in your inventory.

## EOS version compatibility

The read-path tools have been validated against cEOS 4.34.3M. The minimum supported EOS version for read operations is 4.20, which is when eAPI JSON-RPC became stable and `show` commands reliably produce structured JSON output.

Older EOS versions may work for basic `show` commands but are not tested. The `auto` output format falls back to text when JSON output is unavailable, so most read operations will still function on older releases.

## Design notes

- inventory is the trust boundary
- reads are fail-closed on ineligible or denied targets
- the server exposes only documented read-only operations

## Project docs

Additional design and planning docs in the `docs/` directory:

- `docs/design-overview.md` — design overview for evaluators
- `docs/DESIGN.md` — detailed design specification
- `docs/IMPLEMENTATION_PLAN.md` — implemented scope and maintenance priorities
- `docs/CHECKPOINT.md` — current implementation status
- `docs/CODE_WALKTHROUGH.md` — source layout and module guide
- `docs/QUICKSTART.md` — quick start tutorial
- `docs/EXAMPLES.md` — inventory and usage examples

## License

Copyright 2026 Arista Networks, Inc.

This project is licensed under the [Apache License, Version 2.0](LICENSE).
Apache-2.0 applies to each released version of this repository. Arista may
offer later versions under additional or different terms, but cannot revoke
the Apache-2.0 rights granted for versions already released under it.
