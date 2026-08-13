# EOS MCP Server Implementation Plan

## Product boundary

The server is a permanent read-only MCP service. Scope is limited to inventory inspection, device probing, validated EOS `show` commands, bounded logging, facts, and running-configuration retrieval.

## Implemented work

- TypeScript ESM CLI and stdio MCP server.
- Canonical Ansible-style and simplified YAML inventories.
- Strict inventory validation, inherited variables, EOS eligibility, and fail-closed read policy.
- Inventory-authoritative host/group target resolution.
- HTTPS eAPI client with TLS validation, custom CA support, credential validation, request cancellation, and response-size limits.
- Seven MCP tools: server info, inventory, probe, show, logging, facts, and running configuration.
- Local `validate-inventory`, `print-server-info`, and `probe` commands.
- Bounded concurrency, target counts, command counts, logging messages, device responses, and aggregate tool responses.
- Unit, MCP stdio smoke, package-policy, and optional cEOS integration coverage.

## Ongoing priorities

1. Preserve the read-only tool boundary in schemas, CLI, inventory model, and MCP registration.
2. Maintain strict input validation and stable `AppError` codes.
3. Expand read-side test coverage when adding supported EOS query behavior.
4. Keep operator documentation synchronized with the tool and configuration surface.
5. Validate supported read behavior against maintained EOS/cEOS versions.

## Completion criteria

- Every registered MCP tool is read-only and inventory-scoped.
- All device-facing paths use the shared target, connection, timeout, and result-envelope safeguards.
- Documentation lists only supported tools and configuration fields.
- `npm test`, `npm run typecheck`, and `npm run build` pass.
