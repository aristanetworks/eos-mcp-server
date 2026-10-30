# Concurrent EOS MCP calls in Codex

## Cause and applied change

Codex 0.165.0's MCP handler permits parallel calls when either the server connection has `supports_parallel_tool_calls = true` or the tool advertises `annotations.readOnlyHint = true`. Otherwise it defaults to serial execution. EOS tool registrations currently omit annotations, and the project configuration previously omitted the parallel opt-in.

The project's `.codex/config.toml` now contains:

```toml
[mcp_servers.eos]
supports_parallel_tool_calls = true
```

This is a client scheduling setting. EOS diagnostic permissions, packet bounds, global capacity, cancellation, and durable reservations still apply. Ping remains an active diagnostic; it has not been relabeled as read-only merely to influence scheduling.

## Evidence

- Direct stdio requests to the actual EOS server, with a three-second mock at the eAPI client boundary, reached that boundary at the same millisecond and completed together after three seconds. The test used a temporary inventory and separate state directory.
- Three live ping calls submitted together through this conversation reached diagnostic admission one at a time. A read-only observer of the reservation ledger saw one new active reservation at a time despite three available slots.
- After editing the configuration, Codex's installed `app-server --strict-config --print-startup-config` accepted it (exit 0). Before the client refreshed, the conversation still completed three pings at 3.85, 8.07, and 12.16 seconds.
- Subsequent live verification on 2026-10-28 succeeded with server instance `172b506c-8cfc-4508-8a17-bd4463860c02`: three concurrent requests from node2-1, source 10.255.1.3, to 10.255.1.4, 10.255.1.5, and 10.255.1.6 finished at 5.096, 5.184, and 5.038 seconds after submission respectively. Each returned 3/3 replies with zero loss. A read-only observer sampled the live reservation ledger every 50 ms and recorded three simultaneous active diagnostics, confirming execution overlap rather than merely concurrent submission.
- Two subagents could not call EOS tools: the runtime rejected them with `MCP tool eos/eos_ping is not available to the model`. They sent no pings. This is a separate tool-exposure failure; its exact cause is unproven.

## Activation and verification

Reload the Codex client or start a fresh session in this project. A one-session explicit override is also available:

```bash
codex -c 'mcp_servers.eos.supports_parallel_tool_calls=true'
```

Then request three concurrent pings from node2-1, source 10.255.1.3, to 10.255.1.4, 10.255.1.5, and 10.255.1.6, three packets each. Verify overlapping active reservations or server dispatch timestamps, as well as total elapsed time. Concurrent completion should be close to one ping operation plus client overhead rather than the sum of three operations. Do not infer overlap from Promise.all alone.

Two uncertain reservations from interrupted earlier operations currently reduce capacity from five to three. Leave them intact unless completing the documented operator recovery procedure. Three slots suffice for this verification.

The project `.codex/config.toml` is Git-ignored; this fix is local. No EOS server source changes were made. Live verification confirms parallel pings now work.

## Primary sources

- [Codex 0.165.0 MCP handler, supports_parallel_tool_calls](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/tools/handlers/mcp.rs#L162)
- [Codex 0.165.0 configuration schema](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/config.schema.json#L4113)
