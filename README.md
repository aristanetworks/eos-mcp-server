# eos-mcp-server BETA

Read-only MCP server for Arista EOS eAPI (JSON-RPC over HTTPS).

> **Beta status:** this project is under active development.
> **Support:** best-effort only. This open source project is not currently supported by Arista TAC.

This server provides a set of **read-only** tools. It never exposes configuration-changing operations. The server can:

- introspect its own runtime and inventory
- list inventory hosts/groups
- probe EOS device readiness
- run `show` commands
- retrieve bounded logging output for troubleshooting
- collect a fixed set of device facts
- retrieve running configuration

> **Security note:** LLMs have occasionally tried to bypass the MCP server and make configuration changes through other means (for example, SSH). As a best practice, use AAA and scope the authentication credentials used by this server to read-only access.

## Contents

- [What's included](#whats-included)
- [Requirements](#requirements)
- [Install and get started](#install-and-get-started)
- [Server config file](#server-config-file)
- [Connect to an MCP client](#connect-to-an-mcp-client)
- [CLI usage](#cli-usage)
- [MCP tool reference](#mcp-tool-reference)
- [Inventory formats](#inventory-formats)
- [Connection and authentication](#connection-and-authentication)
- [TLS behavior](#tls-behavior)
- [Common troubleshooting](#common-troubleshooting)
- [EOS version compatibility](#eos-version-compatibility)

## What's included

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
- EOS 4.20 or later
- Inventory in one of the supported YAML formats

## Install and get started

1. Install the package globally from npm:

   ```bash
   npm install -g @aristanetworks/eos-mcp-server
   ```

   Prereleases are published under the `next` tag (`npm install -g @aristanetworks/eos-mcp-server@next`). Each [GitHub release](https://github.com/aristanetworks/eos-mcp-server/releases) also attaches the package as a `.tgz`, which you can install with `npm install -g ./aristanetworks-eos-mcp-server-<version>.tgz`.

2. Confirm that the command is available:

   ```bash
   eos-mcp-server --help
   ```

The global install places `eos-mcp-server` on your `PATH`. To remove it later:

```bash
npm uninstall -g @aristanetworks/eos-mcp-server
```

### Upgrading from a `.tgz` install

Versions up to 0.6.1-beta were distributed as `.tgz` files under the unscoped package name `eos-mcp-server`. Both packages provide the same `eos-mcp-server` command, so remove the old one before installing from npm. Otherwise the install can fail with a conflict, or the old version keeps running:

```bash
npm uninstall -g eos-mcp-server
npm install -g @aristanetworks/eos-mcp-server
```

Next, create an inventory, provide the device password, and validate connectivity:

```bash
export EOS_MCP_PASSWORD='replace-with-device-password'

eos-mcp-server validate-inventory --inventory inventory.yml
eos-mcp-server probe --inventory inventory.yml --target leaf1
```

See [Quickstart](docs/QUICKSTART.md) for a complete inventory example and MCP client setup. For building or contributing from source, see the [developer workflow](docs/DEVELOPMENT.md).

## Server config file

The server needs an inventory to start. At minimum, provide one of:

- `--inventory <path>` directly, or
- `--config <path>` pointing at a YAML config file that itself sets `inventory: <path>`

Beyond that minimum, a config file is optional — use one when you want to set additional options such as timeouts, request limits, or a default connection. CLI flags always override config-file values.

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
eapiVersion: latest
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
- `eapiVersion`
- `secretEnvPrefixes`
- `defaultConnection.ansibleUser`
- `defaultConnection.ansibleHttpapiPort`
- `defaultConnection.mcpValidateCerts`
- `defaultConnection.mcpPasswordEnv`

`readTimeoutMs` applies to each device eAPI request. `overallOperationTimeoutMs`, when set, bounds the whole tool call and aborts in-flight device requests once the limit is reached. `maxLoggingMessagesPerRequest` caps `eos_show_logging.message_count` and defaults to 1000. `maxResponseSizeBytes` limits both the buffered HTTP response from each device and the final serialized read-tool result. `eapiVersion` selects the eAPI JSON output schema sent as the `runCmds` `version` parameter: `latest` (the default) returns the current schema for each command, and `1` pins the original schema for consumers that depend on it. It only affects JSON output, so `eos_get_running_config` and `eos_show_logging` are unchanged.

`defaultConnection.mcpPasswordEnv` is a fallback password source. A host or inherited inventory value for `mcp_password_env` or `ansible_password` overrides it. Setting both `mcp_password_env` and `ansible_password` for the same host remains invalid.

## Connect to an MCP client

These examples assume you've already installed `eos-mcp-server` per [Install and get started](#install-and-get-started) above, and have an inventory file (and optionally a [server config file](#server-config-file)) ready.

### Generic stdio example

If `eos-mcp-server` is installed on your `PATH`, point it at just an inventory file:

```json
{
  "mcpServers": {
    "eos": {
      "command": "eos-mcp-server",
      "args": ["serve", "--inventory", "/absolute/path/to/inventory.yml"]
    }
  }
}
```

Or use a [server config file](#server-config-file) if you want to set additional options:

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

If you built the project locally instead of installing the package, replace `"command": "eos-mcp-server"` with `"command": "node"` and put `/absolute/path/to/eos-mcp-server/dist/index.js` first in `args`.

### Claude Code

With just an inventory file:

```bash
claude mcp add eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

Or with a [server config file](#server-config-file) for additional options:

```bash
claude mcp add eos -- eos-mcp-server serve --config /absolute/path/to/eos-mcp-server.yml
```

Add `-s user` before `eos` in either command to make the server available across all your projects instead of just the current one:

```bash
claude mcp add -s user eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

### Codex

Add the server to `.codex/config.toml` in a trusted project, or to
`~/.codex/config.toml` for all projects.

With just an inventory file:

```toml
[mcp_servers.eos]
command = "eos-mcp-server"
args = ["serve", "--inventory", "/absolute/path/to/inventory.yml"]
env_vars = ["EOS_MCP_PASSWORD"]
```

Or with a [server config file](#server-config-file) for additional options:

```toml
[mcp_servers.eos]
command = "eos-mcp-server"
args = ["serve", "--config", "/absolute/path/to/eos-mcp-server.yml"]
env_vars = ["EOS_MCP_PASSWORD"]
```

`serve` is optional because it is the default command, but is shown explicitly
here for clarity. You can also add the server with:

```bash
codex mcp add eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

Then add `env_vars = ["EOS_MCP_PASSWORD"]` to the generated
`[mcp_servers.eos]` table.

### Passing secrets to the MCP server

Prefer exporting secrets in the environment that launches the MCP client:

```bash
export EOS_MCP_PASSWORD='super-secret'
```

For Codex, `env_vars = ["EOS_MCP_PASSWORD"]` forwards that exported variable to
the server. Other MCP clients may support per-server `env` blocks. Avoid
committing secret values to client config files when possible.

## Inventory formats

The server supports exactly one inventory file loaded at startup. The inventory is not watched for changes — to pick up inventory edits, restart the server. Most MCP clients will do this automatically when you restart the client or re-launch the MCP connection.

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

For an inventory where devices do not share a password, see
[`example-inventories/multi-password.yaml`](example-inventories/multi-password.yaml).
Each host sets its own `mcp_password_env` reference, so the actual passwords
remain in the environment rather than in the inventory file. For example:

```bash
export EOS_MCP_SPINE1_PASSWORD='spine1-password'
export EOS_MCP_SPINE2_PASSWORD='spine2-password'
export EOS_MCP_LEAF1_PASSWORD='leaf1-password'
export EOS_MCP_LEAF2_PASSWORD='leaf2-password'

eos-mcp-server validate-inventory \
  --inventory example-inventories/multi-password.yaml
eos-mcp-server serve --inventory example-inventories/multi-password.yaml
```

The password environment variable name is resolved independently for each
host. Host-level values override inherited group or global values, so devices
can be queried together through the `FABRIC`, `SPINES`, or `LEAFS` targets while
still using their individual credentials.

## Important inventory rules

- Targets must be **inventory host or group names**, not IP addresses.
- Host/group names must match `^[A-Za-z0-9_.-]+$`.
- Duplicate YAML keys are rejected.
- The simplified schema reserves `all`; do not define `groups.all` there.
- Group graphs must be acyclic.
- EOS eligibility comes from either:
  - `ansible_network_os: eos`
  - `mcp_platform: arista_eos`
- `mcp_read_allowed` defaults to `true` for eligible EOS hosts. Set it to `false` — inherited like any other variable — to explicitly deny read access to a host or group.
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

## CLI usage

If no subcommand is provided, the CLI defaults to `serve`.

### `serve`

Start the MCP server over stdio.

```bash
eos-mcp-server serve --inventory inventory.yml
eos-mcp-server serve --config eos-mcp-server.yml
```

On startup, `serve` loads the inventory and validates startup connection requirements for EOS-eligible hosts.

### `validate-inventory`

Validate the inventory file.

Default behavior performs:

- inventory parsing and structural validation
- effective inventory validation
- startup-style connection validation for EOS-eligible hosts using the loaded config/default connection settings

Use `--inventory-only` to skip the startup connection checks.

### `print-server-info`

Print the server's sanitized runtime/config summary.

```bash
eos-mcp-server print-server-info --inventory inventory.yml
eos-mcp-server print-server-info --config eos-mcp-server.yml --json
```

### `probe`

Probe a host or group target using the same logic as the MCP tool.

```bash
eos-mcp-server probe --inventory inventory.yml --target leaf1
eos-mcp-server probe --inventory inventory.yml --target leafs --json
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
Policy denied: target clab-testlab-node1-1 includes host(s) not permitted for read operations: clab-testlab-node1-1
```

This means the target resolved to at least one host that is either not marked as EOS eligible (`ansible_network_os: eos` or `mcp_platform: arista_eos`) or has `mcp_read_allowed: false` set.

## EOS version compatibility

The read-path tools have been validated against EOS 4.34.3M. The minimum supported EOS version for read operations is 4.20, which is when eAPI JSON-RPC became stable and `show` commands reliably produce structured JSON output.

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
