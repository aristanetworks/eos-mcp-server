# EOS MCP Server Checkpoint

## Current state

The server is a test-backed, read-only MCP service for Arista EOS eAPI. The product boundary is permanent: configuration-changing operations are outside the implementation and specification.

## Implemented surface

### MCP tools

- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_run_show`
- `eos_show_logging`
- `eos_get_facts`
- `eos_get_running_config`

### Local commands

- `serve`
- `validate-inventory`
- `print-server-info`
- `probe`

## Safety and operational controls

- Inventory-only host and group targeting.
- Explicit EOS eligibility and inherited read-policy enforcement.
- Fail-closed groups containing ineligible or read-denied hosts.
- Strict password-source and environment-prefix checks.
- HTTPS with certificate validation by default and optional custom CA support.
- Validated show commands and bounded logging/running-configuration queries.
- Read-operation concurrency, target, response-size, and timeout controls.
- Sanitized result envelopes with stable machine-readable errors.

## Re-entry reading

1. `README.md` for operator usage.
2. `docs/DESIGN.md` for the authoritative specification.
3. `docs/CODE_WALKTHROUGH.md` for source navigation.
4. `src/operations/readExecution.ts` for shared device operation controls.

## Validation

Run `npm test`, `npm run typecheck`, and `npm run build` after changes. Optional integration tests require the configured cEOS environment.
