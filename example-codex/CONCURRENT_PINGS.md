# Concurrent EOS MCP calls in Codex

## Current behavior

Codex 0.165.0's MCP handler permits parallel calls when either the server connection has `supports_parallel_tool_calls = true` or the tool advertises `annotations.readOnlyHint = true`. Otherwise it defaults to serial execution.

Every EOS tool, including `eos_ping`, now advertises `readOnlyHint: true` ([ADR 0008](../docs/adr/0008-read-only-tool-annotations.md)), so Codex runs independent EOS calls concurrently without any client setting. `supports_parallel_tool_calls = true` under `[mcp_servers.eos]` is only needed with server versions that predate the annotation. It is harmless to keep.

Client concurrency does not bypass the server's limits. Diagnostic permission, packet bounds and the overall timeout still apply, and every eAPI request takes one of its device's shared slots ([ADR 0009](../docs/adr/0009-shared-per-device-eapi-slots.md)):

- each device runs at most `deviceConcurrency` requests at once across all calls (default 3, the measured cEOS limit);
- diagnostics may hold at most `diagnostics.deviceConcurrency` of them per device (default 2), so a slot stays free for show commands;
- diagnostics across the whole server are capped by `diagnostics.maxConcurrentDiagnostics` (default 32).

Concurrent pings to different devices therefore overlap fully, while a third concurrent ping from the same device waits for a slot. A single `eos_ping` call with several `destinations` already runs them concurrently on the server.

## Verification

Request three concurrent pings from different devices, for example node2-1, node2-2 and node2-3, each to 10.255.0.1 with ten packets. They should finish in about the time of one ping (about 9 s on the lab), not three times that. To confirm overlap rather than concurrent submission, call `eos_get_server_info` while they run: `diagnostics.capacity.active_count` should be 3, with one active slot under each host in `devices`.

Do not send all three from one device to test client concurrency: with the default diagnostic share of 2, the third waits for a slot by design.

## History (2026-10-28)

Before the annotation existed, EOS tools advertised no annotations and Codex ran them serially:

- Direct stdio requests to the server, with a three-second mock at the eAPI client boundary, reached that boundary at the same millisecond and completed together after three seconds, so the server itself was never the bottleneck.
- Three live pings submitted together through Codex reached diagnostic admission one at a time, finishing at 3.85, 8.07 and 12.16 seconds.
- Adding `supports_parallel_tool_calls = true` to the project's Git-ignored `.codex/config.toml` fixed it after a client reload: three pings from node2-1 to 10.255.1.4, 10.255.1.5 and 10.255.1.6 finished at 5.10, 5.18 and 5.04 seconds, each with 3/3 replies. Sampling the server's capacity every 50 ms showed three simultaneous active diagnostics. (The server then kept capacity in a durable SQLite ledger, since replaced by in-memory capacity in [ADR 0006](../docs/adr/0006-in-memory-timed-diagnostic-capacity.md).)
- Two Codex subagents could not call EOS tools: the runtime rejected them with `MCP tool eos/eos_ping is not available to the model`. That tool-exposure failure is separate, and its cause was not established.

## Primary sources

- [Codex 0.165.0 MCP handler, supports_parallel_tool_calls](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/tools/handlers/mcp.rs#L162)
- [Codex 0.165.0 configuration schema](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/config.schema.json#L4113)
