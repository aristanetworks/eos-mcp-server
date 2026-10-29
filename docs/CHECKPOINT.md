# EOS MCP Server Checkpoint

## Current state

The server is a test-backed, read-only MCP service for Arista EOS eAPI. The product boundary is permanent: configuration-changing operations are outside the implementation and specification.

## Implemented surface

### MCP tools

- `eos_get_server_info`
- `eos_list_inventory`
- `eos_probe_devices`
- `eos_ping` (bounded active diagnostics to one or more destinations, explicit inventory opt-in)
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
- Configurable diagnostic budgets, in-memory per-server admission, independent timeouts, and uncertain reservations held for the command budget after unknown remote completion (ADR 0006).
- JSON-RPC version/ID and result/error exclusivity validation precedes output interpretation or read-only fallback; unrelated acknowledgements cannot free diagnostic capacity.
- Live sanitized capacity/reservation visibility in server info, including when each uncertain slot frees. A qualified native remote kill/deadline mechanism remains unimplemented; installed EOS requestTimeout is not an end-to-end termination guarantee.
- No retries or shell/SSH fallback for ping. Non-configuring diagnostics are not passive reads; traceroute and capture are not implemented.
- Sanitized result envelopes with stable machine-readable errors.

## Re-entry reading

1. [`README.md`](../README.md) for operator usage.
2. [`docs/DESIGN.md`](DESIGN.md) for the authoritative specification.
3. [`docs/CODE_WALKTHROUGH.md`](CODE_WALKTHROUGH.md) for source navigation.
4. [`src/operations/readExecution.ts`](../src/operations/readExecution.ts) for shared device operation controls.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` after changes. Optional integration tests require the configured cEOS environment. Ping's module and MCP stdio integration suites are qualified on cEOS 4.34.3M; see [DIAGNOSTICS.md](DIAGNOSTICS.md).

Latest verification (in-memory capacity, ADR 0006): unit suite, typecheck, static policy and build pass; `INTEGRATION=1` was run against the cEOS lab, including a second server pinging the same inventory while the first held an uncertain slot.
