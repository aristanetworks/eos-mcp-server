# Share one per-device eAPI slot budget between reads and diagnostics

**Status: accepted.**

Extends [ADR 0007](0007-per-device-diagnostic-concurrency.md) from diagnostics to every eAPI request, and closes the read-tool gap that [ADR 0008](0008-read-only-tool-annotations.md) accepted.

Since every tool advertises `readOnlyHint`, clients run independent calls at once. Diagnostics are bounded per device across calls, but reads are not: the top-level `deviceConcurrency` (default 5) only limits how many hosts one read call contacts at a time. Measured on 2026-10-29 against cEOS 4.34.3M (node2-1, direct eAPI, 5-packet pings of about 4.2 s):

- 3 pings plus 1 `show version`: the show finished at 4.17 s, after the pings; alone it takes about 0.33 s.
- 2 pings plus 4 shows: all shows finished by 0.38 s.
- 5 pings: 3 finished at 4.2 s and 2 at 8.3 s.

The device runs at most three eAPI requests at a time, shared by pings and reads. Three concurrent 10-packet pings therefore hold every read to that device for about 10 s, the default `readTimeoutMs`, so ping traffic can make show commands time out. A separate read limiter would bound read load but would not stop pings from filling the device.

## Decision

One admission controller per server process (`src/operations/eapiSlots.ts`, generalizing the ADR 0007 controller) grants **eAPI slots** for every device request, read or diagnostic:

- Top-level `deviceConcurrency` (default **3**, was 5) becomes what its name says: the slots one inventory host may hold across all calls, matching the measured cEOS eAPI concurrency.
- `diagnostics.deviceConcurrency` (default **2**, was 3) caps how many of those slots diagnostics may hold on one host, so a slot stays free for reads. It must not exceed the top-level value; setting them equal accepts that pings may fill a device.
- `diagnostics.maxConcurrentDiagnostics` (default 32) still caps diagnostics across the process. Reads get no server-wide ceiling.
- The new top-level `readFanOut` (default 10) caps how many hosts one read call contacts at once, taking over the per-call role the old `deviceConcurrency` had. A 50-host read no longer opens 50 connections at once.
- `EapiDeviceReader` takes a slot before each request and frees it when the request settles or is aborted, so `readTimeoutMs` starts at dispatch and queue time counts only against `overallOperationTimeoutMs`. Reads do not take ADR 0006's uncertain hold: they are idempotent, bounded by `readTimeoutMs`, and cheap compared with a ping.
- Waiters are served oldest first, skipping any that cannot run yet. Reads get no priority over diagnostics; the reserved slot already stops pings from filling a device.

## Consequences

- **Breaking:** top-level `deviceConcurrency` changes meaning from per-call fan-out to per-device slots shared by every call, and its default drops from 5 to 3; per-call fan-out moves to `readFanOut`. `diagnostics.deviceConcurrency` drops from 3 to 2 and must not exceed the top-level value, so a configuration that raised only the diagnostic value must raise both.
- Pings alone can never fill a device: a read waits only for other reads ahead of it, never for pings. Concurrent pings per device drop from three to two.
- Many concurrent reads to one device now queue in the server instead of on the device, so a read's `readTimeoutMs` no longer includes time spent behind other requests.
- The `diagnostics.capacity` snapshot keeps its server-wide diagnostic counts and adds `eapi_device_limit`, plus `read_active_count` and `read_queued_count` for each listed host. Server info adds `limits.read_fan_out`.
- The `probe-devices` CLI command runs outside the server and does not use shared slots.
- Other platforms may run more or fewer concurrent eAPI requests; both per-device limits stay configurable.

## Alternatives considered

- **Separate read limiter per device.** Bounds read load but leaves pings able to fill the device and time out reads.
- **Only lower `diagnostics.deviceConcurrency` to 2.** Leaves one device slot for reads with no new code, but reads stay unbounded across calls and can still fill the device themselves.
- **Give reads the uncertain hold.** Adds the lifecycle cost of ADR 0006 for requests that are idempotent and short.
- **Queue every host of a read call at once, as diagnostics do.** Simpler, but lets one group read open `maxReadTargets` connections at once.
