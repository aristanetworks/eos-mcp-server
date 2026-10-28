# EOS MCP Server Design Specification

## Scope

EOS MCP Server is an ESM TypeScript MCP server that provides inventory-scoped, read-only access to Arista EOS devices over eAPI (HTTPS). It runs over stdio MCP transport and is permanently read-only: the implementation exposes operational inspection and diagnostics only, and never exposes configuration-changing operations.

## Tool surface

| Tool | Purpose |
| --- | --- |
| `eos_get_server_info` | Sanitized runtime, limits, and inventory summary |
| `eos_list_inventory` | Eligible hosts and groups |
| `eos_probe_devices` | Connectivity, authentication, and harmless command check |
| `eos_ping` | Explicitly authorized, bounded active ping diagnostics on EOS to one or more destinations |
| `eos_run_show` | Validated single-line `show` commands |
| `eos_show_logging` | Bounded logging retrieval |
| `eos_get_facts` | Fixed device facts |
| `eos_get_running_config` | Running configuration retrieval, with a required section selector for groups |

Local CLI commands provide inventory validation, server-info output, and probing.

## Target boundary

- A target is exactly one inventory host or group name.
- Address, hostname, pattern, and ad-hoc execution targets are rejected. Ping destinations are separate literal IP addresses and may be outside inventory.
- Host and group names use `^[A-Za-z0-9_.-]+$` and cannot collide.
- Group hosts are deduplicated and ordered alphabetically.
- Canonical inventories merge repeated group declarations with host/child union and later-wins variables.

## Inventory and policy

Canonical Ansible-style YAML and simplified YAML are supported. Structural keys are strict; arbitrary variables remain permitted. EOS eligibility requires `ansible_network_os: eos` or `mcp_platform: arista_eos`; conflicting declarations fail validation.

`mcp_read_allowed` defaults to `true` for eligible EOS hosts and follows inherited inventory variable precedence. Operational requests fail closed when any resolved host is ineligible or read-denied — a mixed or ineligible target fails as a whole, and devices are never silently skipped. The inventory is the only policy source.

`mcp_diagnostics_allowed` defaults to `false` and must explicitly resolve to boolean `true` to permit diagnostics. It follows existing inheritance; EOS eligibility and read permission are prerequisites. Mixed diagnostic permission in a group fails the entire request before dispatch.

## Connection security

- HTTPS is required.
- Certificate validation defaults to enabled; inventory may set an explicit lab override and server config may provide a CA bundle.
- A host resolves exactly one password source: `mcp_password_env` or `ansible_password`. The environment reference is preferred and must match a configured prefix (`EOS_MCP_` by default).
- Startup validation verifies connection data for all eligible hosts.

## Command safety

`eos_run_show` accepts only trimmed, single-line commands beginning with `show`. It rejects control characters, shell metacharacters, and CLI output modifiers. `eos_get_running_config.section` uses the same single-line restrictions. Enable mode is used only for operations that need it, currently running configuration and ping. Diagnostics accept typed, validated arguments, not arbitrary command strings; the show-only validator is not relaxed.

## Runtime controls

Read requests have configured per-device timeout, optional overall timeout, device concurrency, target-count, command-count, logging-message, and response-size limits. The overall timeout aborts in-flight requests and halts further scheduling. Device HTTP responses and final serialized tool results are size-limited.

### Active diagnostic controls

`eos_ping` uses independent `diagnostics` settings with finite defaults: count 3/max 10, aggregate probes 100 (hosts × destinations × count), 16 destinations per call, server-wide device concurrency 5, reply timeout 1000 ms, command budget 30000 ms, HTTP timeout 35000 ms, and overall timeout 60000 ms. All are configurable; target and response-size limits are shared with reads. Config validation requires consistent counts, execution budgets, and HTTP timeouts.

A ping request names one or more destinations and sends exactly one text-mode eAPI request per host and destination, without automatic retries. Those executions run concurrently under the shared admission controller, each with its own reservation, and return one result per host and destination. Fixed count, one-second interval, fixed size 64, and reply timeout bound device work; the command budget is not a native remote kill timer. HTTP abort is not proof of remote completion. Unknown completion retains its global admission slot indefinitely; elapsed time is never completion evidence. When all capacity is uncertain, new and queued work fail closed with `diagnostic_capacity_uncertain`. Server info exposes current sanitized capacity and reservation state. Production commits reservations before dispatch to a private SQLite ledger and commits confirmed removal before reusing capacity. Unfinished entries restore as uncertain across restarts; only one server may own a ledger. Invalid, mismatched, or missing companion state fails closed. `inspect-diagnostics` provides read-only offline inspection without ownership takeover or device access. Ledger location is configurable as `diagnostics.stateFile`, otherwise derived from the canonical inventory path under the user's state directory. Offline operator-attested release requires independent fencing evidence covering running, accepted queued and replayable work, exact IDs, explicit confirmation and exclusive ownership. Schema-2 audit and deletions commit atomically; inspection is read-only, and neither a reset nor a release is exposed through MCP. Authority is the OS-authorized operator, not automated validation of fencing truth. A qualified native remote deadline remains unresolved; timeout-shaped RPC errors are not assumed to confirm process exit. Cancellation stops scheduling and aborts HTTP requests; overall timeout remains a request-level failure without partial results. See [DIAGNOSTICS.md](DIAGNOSTICS.md) for the full lifecycle assumptions and limits.

Only unicast literal destinations are supported; DNS, scoped/link-local IPv6, multicast, unspecified, and limited broadcast addresses are rejected. Optional VRF/source selection must not fall back. Directed-broadcast detection is not guaranteed from an address alone.

## Result and error model

Every eAPI response must identify JSON-RPC 2.0, match its request ID exactly, and contain exactly one result/error member before interpretation. Missing or mismatched identity is `eapi_response_uncorrelated`, not completion evidence. Diagnostic wire IDs are journaled before dispatch and survive uncertain restarts; legacy records without wire IDs are not retroactively correlated. Correlation IDs do not provide an EOS job lookup, cancellation, or idempotency facility.

Device-facing tools return target metadata, resolved devices, summary counts, and per-device results. Request-level failures and known device failures use `AppError` machine-readable codes. Supported read tools expose raw eAPI payloads only through an explicit `include_raw` option. Ping separates successful execution from a reachability finding and returns normalized loss/RTT measurements; original EOS text is opt-in. Unrecognized output is an explicit device failure, never an invented finding.

## Compatibility and validation

The read surface is validated against cEOS 4.34.3M. EOS 4.20 is the documented minimum for supported read operations. Ping is separately qualified on cEOS 4.34.3M; its compatibility with older EOS versions or physical platforms is not established by the existing read-path minimum. Traceroute and packet capture remain future work requiring their own capability and lifecycle decisions. Changes must preserve strict TypeScript checks and pass the unit, stdio smoke, and package-policy test suites.
