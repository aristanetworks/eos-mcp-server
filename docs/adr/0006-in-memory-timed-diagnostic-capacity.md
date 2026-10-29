# Replace the durable diagnostic ledger with in-memory, time-bounded capacity

Supersedes [ADR 0002](0002-fail-closed-diagnostic-reservations.md), [ADR 0003](0003-durable-diagnostic-ledger.md) and [ADR 0004](0004-offline-operator-attested-release.md). [ADR 0001](0001-non-configuring-diagnostics.md) and [ADR 0005](0005-multi-destination-ping.md) stay in force.

ADRs 0002 to 0004 held an execution's slot forever when its completion was unknown, because a delivered eAPI request might in principle sit in an EOS queue and start later. Holding slots forever then required a durable SQLite ledger so restarts could not reset them, an exclusive ownership lock so a second process could not allocate fresh capacity, and an offline operator attestation and audit workflow to recover stuck slots. The exclusive lock was taken at server start whenever any host allowed diagnostics, so only one MCP server per inventory could run. A second chat session, or the desktop app alongside a Code session, failed to start at all, losing every read-only tool as well as `eos_ping`.

That machinery guarded a failure mode the project never observed: the lifecycle investigation reports that no delayed-queue fault was reproduced. Being wrong about it costs little. A ping execution is capped at `maxPingCount` 64-byte probes at one-second pacing, changes no configuration, and cEOS ran at most three eAPI commands concurrently per device regardless of server capacity. Against that, the design cost every user concurrent sessions, could permanently remove capacity after one timeout, and required a human attestation to recover.

Capacity is now per server process and in memory. A confirmed completion or a rejection established before dispatch frees its slot at once. An execution whose completion is unknown (transport loss, HTTP timeout, malformed or uncorrelated response, cancellation, or a post-dispatch RPC error) keeps its slot as **uncertain** for `commandTimeoutMs`, the configured worst-case execution budget, measured from the moment it became uncertain. The slot then frees itself; a late confirmed response frees it sooner. Uncertain slots count against `deviceConcurrency` like active ones, so new work queues behind them within the overall deadline instead of failing with a dedicated error.

Accepted consequences:

- `deviceConcurrency` limits one server process, not an inventory. N concurrent sessions can run up to N × `deviceConcurrency` pings. The per-request limits (`maxPingCount`, `maxProbesPerRequest`, `maxDestinationsPerRequest`) and the device's own eAPI concurrency still bound load.
- A restart forgets uncertain slots. Under normal EOS scheduling the original command has finished within `commandTimeoutMs` of dispatch anyway.
- If EOS did queue a request for longer than the hold, replacement work could overlap it. This is the risk ADR 0002 refused; it is now accepted as bounded and low-impact for ping.

Removed: the SQLite ledger and its ownership lock, `diagnostics.stateFile`, the `inspect-diagnostics` and `release-diagnostics` commands, fencing attestations and release audit, the `diagnostic_capacity_uncertain` and `diagnostic_state_*` error codes, and the `scope`, `storage_error_code` and `rpc_request_id` fields of the capacity snapshot (`reservation_id` is the wire RPC ID). Existing ledger files under `$XDG_STATE_HOME/eos-mcp-server/` are no longer read and can be deleted. JSON-RPC response correlation, write-ahead classification of dispatch state, and the no-automatic-retry rule are unchanged.

Ping requests also send EOS's native `runCmds.requestTimeout`, set to `commandTimeoutMs`, so the device interrupts a command that outlives the same budget the server holds an uncertain slot for. It is on by default and can be disabled with `diagnostics.nativeRequestTimeout: false` for an EOS version that rejects the field. It covers execution only, not time queued before execution, and its timeout error is still treated as unknown completion.

Revisit this if a diagnostic with real side effects or long remote lifetimes is added, such as packet capture. That operation should get its own lifecycle decision rather than inheriting ping's.
