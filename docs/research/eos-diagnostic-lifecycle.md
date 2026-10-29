# EOS HTTPS eAPI diagnostic lifecycle

> Historical investigation. [ADR 0006](../adr/0006-in-memory-timed-diagnostic-capacity.md) later chose to hold uncertain capacity for the command budget instead of indefinitely, accepting the unreproduced delayed-queue risk described here.

## Conclusion

**No dispatch-relative deadline, durable execution-token lifecycle, or definitive cancellation guarantee was qualified for ping.** However, EOS **does expose a native `runCmds.requestTimeout`**: saying eAPI has only a client-side timeout would be incorrect. Its installed implementation is an execution-stage interruption timer, not a verified admission-to-process-exit bound. Losing HTTP completion evidence must therefore remain an uncertain reservation, not become free capacity after a cooldown.

Scope: installed cEOS lab image `ceos-lab:4.34.3M`, inspected on `node1-1`; HTTPS checks against `172.20.20.11`, 2026-10-27 UTC. Repository context: `docs/DIAGNOSTICS.md` and ADRs `0001`/`0002`. Those documents describe requirements/current behavior, not independent proof of EOS capabilities.

## Evidence and qualification

### Measured in this investigation

- HTTPS `runCmds`, version 1, text format, commands `enable` and `show version`, with `requestTimeout: 5.0`, `ignoreDisconnect: false`, and `timestamps: true`, returned HTTP 200 and matching JSON-RPC ID in approximately **0.023 s**. EOS reported **4.34.3M-44102239.4343M (engineering build)**. This proves these parameters are accepted on this device, **not** that timeout expiry terminates ping.
- HTTPS `getCommandHelp` and enable-mode `getCommandCompletions` inspected ping syntax without executing ping. Completion after `ping 127.0.0.1 ` offered `repeat`, `timeout`, `interval`, size/source/interface/pattern/DF/record-route options; timeout accepted `<0-3600>` seconds. A `deadline` suffix produced no completions. This agrees with the installed grammar, but is not an exhaustive test of every possible CLI wrapper.
- **The initial source investigation emitted zero ping probes**; it performed no connection-loss experiment, forced timeout, process termination, configuration change, recovery/reset, SSH, capture, or load test. A later bounded expiry experiment is recorded separately below. HTTP calls had a 10-second client timeout and bounded response reads. Lab certificate verification was disabled only for these research calls; no credentials or configuration are included here.

### Bounded native timeout-expiry follow-up

A later normal-load HTTPS experiment used text-mode `enable` plus `ping ip 127.0.0.1 repeat 4 timeout 1 interval 1 size 64`, with `requestTimeout: 0.25`, `ignoreDisconnect: false`, `timestamps: true`, version `latest`, and an eight-second client limit. The command could emit at most four loopback probes; no configuration change, SSH, capture, overload, recovery/reset, or external process kill was performed.

- The matching JSON-RPC response arrived after **273 ms**, HTTP 200, with error code **1001**, message ending in `unexpected error 408`, and an error entry `Command exceeded its allowed time limit`.
- No exact-name `ping` process was observed in samples at **274, 409, 940, and 4492 ms** after dispatch.
- This establishes native interruption behavior in one normal-load case on the installed engineering build. It **does not** establish a bound on admission delay, cleanup/reaping under faults, queued-request invalidation, disconnect propagation, other versions, or the public support contract.
- Sampled process absence and an interruption response are not durable fencing evidence. The product still does not enable this internal option or release uncertain reservations on native timeout errors. A regression fixture now covers the observed 1001/408 error shape.

Local raw observations and the bounded reproducer are in `.local-artifacts/diagnostics-native-timeout/observations.json` and `experiment.mjs`; credentials are not recorded in the evidence JSON. These are measured follow-up artifacts, not a substitute for a supported lifecycle guarantee.

### Source-backed capabilities

Installed paths below are **inside `node1-1`**, under `/usr/lib/python3.9/site-packages/` unless otherwise stated. Findings paraphrase implementation rather than reproduce proprietary source.

| Evidence | What it establishes |
| --- | --- |
| `JsonCli.py:345-389`, especially `350`, `364-373`; forwarding at `137-162` | `runCmds` accepts `requestTimeout` in seconds, described as an internal CAPI/eAPI request-termination mechanism distinct from socket timeout. `ignoreDisconnect` defaults false; its description distinguishes operational commands from configuration-command continuation. These are real exposed parameters, not product inventions. |
| `CliApi.py:479-526` | The timer is created **after session update**, when the backend reaches `executeCommands`, before executing the command list. It is not an absolute timestamp carried from the client, nor a timer armed at client dispatch/HTTP admission. |
| `CliApi.py:105-143`, `411-477` | Expiry signals tracked child process groups with SIGINT where applicable and interrupts the command thread. The command loop handles interruption and terminates its session. This is a native attempt to interrupt the request, not merely abandonment of the HTTP response. |
| `CliServerLib.py:545-558`, `729-743`, `850-865`, `1023-1050` | EOS tracks child PIDs, attempts group signalling, and has disconnect/final-cleanup paths. SIGINT can skip marked children; signalling errors are caught. These paths do not supply an externally queryable process-reaped acknowledgement or a bounded signal-to-exit contract. |
| `CapiUwsgiServer.py:224-281`; `EapiClientLib.py:206-220`; `CliPatchSigint.py:186-208` | HTTPS command handling creates a stateless backend connection and closes it during cleanup; backend disconnect can cause interruption/child cleanup. This does **not** prove when an external HTTP loss is detected or propagated through the HTTP server and backend, or what the client can verify after losing the response. |
| `CliPlugin/NetworkToolsCli.py:208-257`, `287-373`, `388-411` | Enable-mode IPv4/IPv6 ping has finite-count/pacing/reply-wait options. EOS maps `repeat` to `-c`, `timeout` to **`-W`**, and `interval` to `-i`; the inspected handler supplies no `-w` whole-ping deadline. It waits using `communicate()` on the child. No ping deadline/job/status/cancel option occurs in this grammar. |
| `JsonCli.py:180-211`, `215-216`, `284-285`, `344-354`; `CliServerLib.py:593-620`; `JsonRpcBase.py:119-123`, `260-304`, `393-395` | The inspected backend exports completion/help/prompt, configuration operations, and `runCmds`; it exports no execution-token status/cancel method. JSON-RPC `id` is client-supplied, echoed, and cleared from request-local state. It is correlation, not demonstrated durable identity, deduplication, or a retrievable execution record. Configuration sessions are not diagnostic jobs. |
| `CliApi.py:495-497`, `596-626` | `timestamps` supplies command execution timing in returned results, not a lookup handle or deadline. |

The installed API explorer independently describes ordered command execution and an echoed request ID: `/usr/share/nginx/html/eapi/main.js:2`, protocol prose near character offsets 1,340,000–1,369,000. Its request builder on the same line, near offset 1,191,844, exposes ordinary execution options but omits `requestTimeout`/`ignoreDisconnect`. **Installed acceptance/internal documentation is established; a public support contract for these internal controls is not.**

Official public client sources corroborate the transport distinction:

- Arista [goeapi, pinned revision, request builder](https://github.com/aristanetworks/goeapi/blob/7090068b8735dc15c22444cbda080db4052ae8af/eapilib.go#L183-L190) sends `runCmds`; its [timeout implementation](https://github.com/aristanetworks/goeapi/blob/7090068b8735dc15c22444cbda080db4052ae8af/eapilib.go#L455-L461) sets an HTTP-client timeout, not a remote deadline.
- Arista EOS+ [pyeapi, pinned revision](https://github.com/arista-eosplus/pyeapi/blob/6816d9e498f06d773fd97121b805dec198c9f6e2/pyeapi/eapilib.py#L314-L364) builds the echoed client ID and filters allowed request parameters; this revision's allowlist does not forward `requestTimeout`/`ignoreDisconnect`. Its [HTTPS connection](https://github.com/arista-eosplus/pyeapi/blob/6816d9e498f06d773fd97121b805dec198c9f6e2/pyeapi/eapilib.py#L669-L686) passes timeout to the transport. Client-library omissions do not establish server incapability.

## Answers

### 1. Supported dispatch-relative or whole-process deadline without shell execution?

**Native execution-stage timer: yes. Qualified dispatch-relative/whole-process deadline: no.** `requestTimeout` can accompany the normal text-mode `enable` + ping request without a shell command. It applies to the backend command list, not to each ping reply. But backend/session/admission delay before timer creation is outside its measured interval; expiry uses asynchronous interruption, not a verified process-exit deadline. A stalled scheduler is also outside any demonstrated bound.

The supported ping grammar's `timeout` remains a reply wait. Finite repeat/interval/reply settings constrain normal work, not start time. Treat any count-based duration formula as an **assumption-dependent execution estimate**, not permission to release capacity at dispatch time plus that estimate. Hard-deadline behavior and public support for the internal request timer remain unqualified. The follow-up experiment above observes expiry/interruption under normal load, not an admission-to-process-exit guarantee.

### 2. Lost-request lookup or cancellation using a durable token?

**Not established.** The inspected HTTPS dispatcher has no such exported method, and its JSON-RPC ID is not an execution token. `ignoreDisconnect: false` enables EOS interruption behavior; it is neither an explicit cancellation RPC nor an acknowledgement that pending work cannot later execute. Reusing an ID is not demonstrated idempotency and must not justify retrying a ping.

This is a scoped finding about inspected code/protocol, **not proof that every EOS release, extension, or separate management service lacks lifecycle facilities**.

### 3. Positive evidence that can safely authorize capacity release?

For the exact reserved attempt, with trustworthy request/device correlation:

- **Normal final synchronous completion:** a complete EOS result after the ping handler's child wait returned. Reachability success is unnecessary; a normally completed zero-reply ping also qualifies.
- **Definitive rejection before diagnostic execution:** evidence from a known EOS processing path that the diagnostic was not dispatched and cannot remain queued. Generic HTTP/proxy errors, malformed payloads, or arbitrary JSON-RPC error labels are not enough.
- **Separately verified terminal/fencing evidence:** evidence that both executing work and any previously accepted/queued work for that attempt can no longer run. No native token-bound acknowledgement meeting this condition was qualified here.

Caution: `CliApi.py:387-390, 415-430, 459-477` initializes an interrupted command's response as request-timeout status and returns on `KeyboardInterrupt`. A timeout-shaped error is therefore **not by itself a process-reaped certificate**. Qualify the specific terminal/error path before interpreting it as completion.

Elapsed time, local abort, an empty process list, packet-counter silence, or availability of another HTTP request are not positive evidence against later dispatch. No delayed-queue fault was reproduced; its exclusion is simply not guaranteed by the evidence available.

### 4. Purely observational automatic reconciliation?

**Not defensible from process snapshots/time alone.** Repeated absence of a running ping cannot rule out a request not yet started. A source-understood late final response could automatically reconcile its own reservation; that is positive completion evidence, not inference from silence.

Without such evidence or a qualified durable native lifecycle, recovery requires **operator attestation grounded in out-of-band evidence** covering the original device/execution epoch, running work, pending accepted requests, and prevention of later dispatch/replay. An operator merely waiting or observing no process is insufficient. A persistent local journal preserves uncertainty and correlation across restart; it cannot manufacture remote completion proof. New product reservations persist the exact `rpc_request_id` before dispatch and accept only a JSON-RPC 2.0 response matching that ID, with exactly one result/error member. Legacy journal entries without a wire ID remain unknown; no ID is invented for them. These are product correlation checks, not an EOS status-token facility. This research defines no recovery mechanism or new product tool.

## Limits

The official [EOS Command API manual URL](https://www.arista.com/en/um-eos/eos-command-api) returned a “Client Challenge” page rather than manual content. That access failure is **not evidence of feature absence**. Public support guarantees, other releases/platforms, undisclosed/native lifecycle interfaces, expiry behavior under faults, and bounded HTTP-disconnect propagation remain unverified. The installed engineering-build findings should be confirmed with Arista before relying on them as a production lifecycle contract.
