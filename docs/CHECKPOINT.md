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
- `inspect-diagnostics` (read-only persisted state and audit, no device access)
- `release-diagnostics` (offline operator attestation, explicit scope and atomic audit)

## Safety and operational controls

- Inventory-only host and group targeting.
- Explicit EOS eligibility and inherited read-policy enforcement.
- Fail-closed groups containing ineligible or read-denied hosts.
- Strict password-source and environment-prefix checks.
- HTTPS with certificate validation by default and optional custom CA support.
- Validated show commands and bounded logging/running-configuration queries.
- Read-operation concurrency, target, response-size, and timeout controls.
- Configurable diagnostic budgets, durable ledger-scoped admission, independent timeouts, and indefinite fail-closed reservations after uncertain remote completion.
- Write-ahead SQLite reservations, exact wire-ID persistence/correlation, exclusive crash-released ownership, restoration of unfinished work as uncertain, and fail-closed storage errors.
- JSON-RPC version/ID and result/error exclusivity validation precedes output interpretation or read-only fallback; unrelated acknowledgements cannot free diagnostic capacity.
- Live sanitized capacity/reservation visibility in server info; `diagnostic_capacity_uncertain` prevents new or queued work when all capacity is uncertain. Persistence and offline inspection are implemented. Offline operator-attested release is implemented, not an EOS completion proof. A qualified native remote kill/deadline mechanism remains unimplemented; installed EOS requestTimeout is not an end-to-end termination guarantee.
- No retries or shell/SSH fallback for ping. Non-configuring diagnostics are not passive reads; traceroute and capture are not implemented.
- Sanitized result envelopes with stable machine-readable errors.

## Re-entry reading

1. [`README.md`](../README.md) for operator usage.
2. [`docs/DESIGN.md`](DESIGN.md) for the authoritative specification.
3. [`docs/CODE_WALKTHROUGH.md`](CODE_WALKTHROUGH.md) for source navigation.
4. [`src/operations/readExecution.ts`](../src/operations/readExecution.ts) for shared device operation controls.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` after changes. Optional integration tests require the configured cEOS environment. Ping's module and MCP stdio integration suites are qualified on cEOS 4.34.3M; see [DIAGNOSTICS.md](DIAGNOSTICS.md).

Latest refactor verification: **362 tests across 40 files passed** with `INTEGRATION=1`, plus typecheck, static policy, build, and whitespace checks. Independent read-only review found no findings. Synthetic ledgers written by pre-refactor commit `0e208ec` retained compatible audit checksums, inspection, committed retries, legacy RPC identities, and remaining capacity. No real EOS reservations were operator-released in these checks.
