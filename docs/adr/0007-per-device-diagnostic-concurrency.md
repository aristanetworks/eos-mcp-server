# Limit diagnostic concurrency per device, under a server-wide ceiling

Refined by [ADR 0009](0009-shared-per-device-eapi-slots.md): reads now share each device's slots, the top-level `deviceConcurrency` (default 3) is the per-device total, and `diagnostics.deviceConcurrency` (default 2) is the diagnostic share.

Refines the admission limit of [ADR 0005](0005-multi-destination-ping.md) and [ADR 0006](0006-in-memory-timed-diagnostic-capacity.md). Their reservation lifecycle, uncertain-slot hold, and no-retry rules are unchanged.

Until now `diagnostics.deviceConcurrency` (default 5) was one first-come pool for the whole server process; despite its name it did not know which device a slot belonged to. Measured on 2026-10-29 against the cEOS 4.34.3M lab, that made a VTEP full mesh (six hosts, five destinations each, one call per host from six concurrent subagents) take turns: each call took all five slots, but the device ran only three pings at a time. Six direct concurrent eAPI pings to one device finished as three at about 2.1 s and three at about 4.3 s. The two extra slots per call sat queued on the device while idle devices waited for capacity, so calls finished one after another about 2 s apart. The single pool also let one unhealthy device block every other: a few uncertain slots on it held the whole server's capacity for `commandTimeoutMs`.

Admission now has two limits. `diagnostics.deviceConcurrency` (default 3, the measured cEOS eAPI concurrency) caps the slots one inventory host may hold. `diagnostics.maxConcurrentDiagnostics` (default 32) caps the slots of the whole server process; `deviceConcurrency` must not exceed it. A slot is granted only while both have room. Waiters are served oldest first, skipping any whose device is still full, so a ping queued for a busy device never holds up a later ping to a free one. Uncertain slots count against their own device and the server-wide ceiling, so an unhealthy device mostly blocks itself. A request queues all its executions with the controller at once rather than through a per-call worker pool, because a host-ordered pool would wait on the first host's queue while later hosts sat idle. `maxProbesPerRequest` still bounds how many executions one request creates.

Accepted consequences:

- **Breaking:** an existing `deviceConcurrency` setting keeps its value but now applies per device. A configuration that relied on it to cap the whole server must also set `maxConcurrentDiagnostics`.
- Load on any one device from one server process drops from five to three concurrent pings by default, while total load across devices can rise to 32. N concurrent server processes can still run N times these limits.
- The capacity snapshot's top-level counts stay server-wide. It adds `device_limit` and a `devices` breakdown (available, active, uncertain and queued slots for each host holding or awaiting a slot); server info adds `limits.diagnostics.max_concurrent_diagnostics`.
- The default of 3 matches cEOS 4.34.3M only. Physical platforms may run more or fewer eAPI commands concurrently; extra slots beyond a device's own limit only queue on the device while holding a reservation.
