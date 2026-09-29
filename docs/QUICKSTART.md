# Quickstart: eos-mcp-server with Claude Code

This guide gets you from the npm package to a working MCP server inside Claude Code.

## Prerequisites

- Node.js 24+
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)
- One or more Arista EOS devices reachable via eAPI (HTTPS)

## 1. Install the package globally

```bash
npm install -g @aristanetworks/eos-mcp-server
```

Verify it's on your PATH:

```bash
eos-mcp-server --help
```

## 2. Create an inventory file

Create `inventory.yml` with your EOS devices. Replace the hostnames, IPs, and credentials to match your environment.

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

If your devices use self-signed certificates, add `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`) under `vars`:

```yaml
vars:
  ansible_user: admin
  ansible_network_os: eos
  mcp_password_env: EOS_MCP_PASSWORD
  mcp_validate_certs: false
```

## 3. Export the password

The `mcp_password_env` value is an environment variable **name**, not the password itself. Export the actual password:

```bash
export EOS_MCP_PASSWORD='your-device-password'
```

## 4. Validate and test

Validate the inventory:

```bash
eos-mcp-server validate-inventory --inventory inventory.yml
```

Probe a device to confirm connectivity:

```bash
eos-mcp-server probe --inventory inventory.yml --target leaf1
```

You should see:

```text
Probe target: leaf1
Devices: 1/1 succeeded
- leaf1: success
```

## 5. Add the MCP server to Claude Code

```bash
claude mcp add eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

Use absolute paths for the inventory file since Claude Code may launch the server from any working directory.

For additional options such as timeouts, request limits, or a default connection, use a [server config file](../README.md#server-config-file) instead and point `--config` at it.

To make it available across all your projects, add `-s user`:

```bash
claude mcp add -s user eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

### Passing the password to Claude Code

The simplest approach is to export `EOS_MCP_PASSWORD` in your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) so it's available whenever Claude Code starts the server.

Alternatively, add it inline when registering the server:

```bash
claude mcp add -e EOS_MCP_PASSWORD=your-device-password eos -- eos-mcp-server serve --inventory /absolute/path/to/inventory.yml
```

## 6. Verify in Claude Code

Start Claude Code and ask it to use the server:

```
> List my EOS inventory
```

```
> Probe leaf1
```

```
> Show me the version on leaf1
```

Claude will call the `eos_list_inventory`, `eos_probe_devices`, and `eos_run_show` tools automatically.

## Available MCP tools

Once connected, Claude Code has access to these tools:

| Tool                     | Description                              |
| ------------------------ | ---------------------------------------- |
| `eos_get_server_info`    | Server runtime summary and capabilities  |
| `eos_list_inventory`     | List inventory hosts and groups          |
| `eos_probe_devices`      | Check device reachability                |
| `eos_run_show`           | Run `show` commands on devices           |
| `eos_show_logging`       | Retrieve bounded logging output          |
| `eos_get_facts`          | Collect device facts from `show version` |
| `eos_get_running_config` | Retrieve running configuration           |

## Troubleshooting

**`npm install -g` fails with permission errors** — Run with `sudo` or configure npm to use a user-writable prefix (`npm config set prefix ~/.npm-global`).

**`Password env var ... is not set`** — Export `EOS_MCP_PASSWORD` before launching Claude Code, or pass it via `-e` when adding the server.

**`Password env var ... does not match any allowed prefix`** — The env var name must start with `EOS_MCP_` by default. Use a name like `EOS_MCP_PASSWORD`, not the password itself.

**Certificate validation failure** — For a lab device, add `mcp_validate_certs: false` (or `ansible_httpapi_validate_certs: false`) to your inventory vars. To trust a real CA instead, set `caFile` in a [server config file](../README.md#server-config-file). See [TLS behavior](../README.md#tls-behavior) for details.

**`Unknown inventory target ...`** — Targets must be inventory host or group names (e.g., `leaf1`), not IP addresses.

See the full [README](../README.md) for detailed configuration options.
