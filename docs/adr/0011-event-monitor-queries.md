# Read the Event Monitor through `eos_run_show` with a server-controlled privileged-show list

**Status: proposed. Measured on cEOS 4.34.3M only; tracks issue #20.**

The goal is to let an LLM answer questions such as "when did 10.1.0.0/24 last change on leaf1?" or "which MACs moved on Ethernet3 in the last hour?" from the **Event Monitor**, without adding a tool and without letting the caller decide when EOS privileged mode is used.

## What EOS does

Measured on 2026-11-13 against node2-1 of the cEOS 4.34.3M lab, with `getCommandCompletions` (preamble `enable`) and text-mode eAPI. The node's configuration and flash were restored afterwards.

- Every `show event-monitor` command requires privileged mode. Without `enable`, eAPI answers "Invalid input (privileged mode required)", so today's `eos_run_show` cannot run any of them.
- JSON is not available: `format: "json"` fails with error 1003 "unconverted command". Output is text: pipe-delimited rows, with a padded header row for some **Event Types** (route) and none for others (mac).
- The **Event Monitor** is stopped by default (`default event-monitor`). While it is stopped, every **Event Query** and **Event SQL Query** fails with error 1000 "% event-monitor not running. It can be started by running 'event-monitor' command in config mode". `show event-monitor status` still succeeds, prints that text on a `! ` line and returns it as an eAPI warning.
- **Event Types** on the device: `arp mac route route6 neighbor igmpsnooping mldsnooping mroute lacp nat stpunstable`, `nexthop-group backup-activation`, `nexthop-group rpc`, and `all`. Arista's manual lists fewer. `status` and `row-limit` also accept `vxlanmac`. `nat` and both nexthop-group types are disabled by default; the rest are enabled.
- Options can come in any order: `limit <1-15000>`, `match-time last-minute|last-hour|last-day|last-week`, `group-by <attribute>`, and per-type `match-*` filters (for example `route` has only `match-ip`; `mac` has `match-interface`, `match-mac`, `match-type`, `match-vlan`, `match-vtep`). Filter values are **Event Filters**: `match-ip 198.51.100.%` matched `198.51.100.99/32`. Invalid options get the device's ordinary "Invalid input" error.
- `show event-monitor row-limit all` fails with error 1001 (`'l1dr'`) even while the **Event Monitor** runs.
- `show event-monitor sqlite <statement>` reads `/var/log/EventMon/eventMon.db`. The database is opened read-only: `DELETE`, `CREATE TABLE` and `DROP TABLE` fail with "attempt to write a readonly database", `load_extension` fails with "not authorized", and a second statement fails with "You can only execute one statement at a time". A trailing `;` is accepted.
- **`ATTACH DATABASE '/mnt/flash/x.db' AS p` created an empty file on flash, and `VACUUM INTO '/mnt/flash/x.db'` wrote a 272 KB copy of the database there.** Read-only mode does not stop SQLite from creating or writing other files.
- The sqlite statement consumes the rest of the line: `|`, `||`, `>` and `<` inside it reached SQLite as SQL (`select 'a' || 'b'` returned `ab`; `select 1 | tee flash:x` and `select 1 > flash:x` were SQL syntax errors and wrote nothing). On other event-monitor commands, `| tee flash:x` **did** write a file.

## Decision

`eos_run_show` runs `show event-monitor` commands. The server alone decides when a request runs in privileged mode; the caller has no input that requests it.

- **Built-in privileged-show list.** The code holds the only list of **Privileged Show Commands**, currently just `show event-monitor`. Adding an entry is a code change that needs the same kind of evidence as above: the command needs privileged mode, and nothing it accepts changes device state or writes files, or the server blocks whatever does.
- **Whole-keyword matching.** A command is a **Privileged Show Command** when its leading whitespace-separated words, compared case-insensitively, equal an entry's words exactly. Abbreviations such as `sh ev route` do not match; they run unprivileged and fail on the device. `eos_run_show` already requires `show` to be spelled out.
- **All or nothing.** A request runs with `enable` prepended only when every command in it is a **Privileged Show Command**. A request mixing privileged and unprivileged commands is rejected before dispatch with `show_command_privilege_mixed`, so no other command can ride along in privileged mode. Otherwise the request runs unprivileged, as today.
- **Operators may narrow, never widen.** A new server setting, `privilegedShowCommands`, defaults to the built-in list. It accepts only a subset of that list, and any other entry fails config loading. `[]` turns privileged mode off for `eos_run_show`, so event-monitor commands then fail on the device. An operator therefore cannot add, for example, `show running-config`, which would bypass `eos_get_running_config`'s group `section` rule. There is no per-host setting.
- **Visible.** Each command result in a privileged request carries `privileged: true`, and `eos_get_server_info` reports the effective `privilegedShowCommands`.
- **Single-line check unchanged for typed queries.** Every command except an **Event SQL Query** still passes the existing check, which forbids `|`, `>`, `<`, `;`, `&`, `` ` `` and `$`. That is what blocks `| tee flash:x`.
- **Guarded Event SQL Queries.** A command of the form `show event-monitor sqlite <statement>` replaces that check with an SQL guard. After trimming, and removing one trailing `;`, the statement must:
  - start with `SELECT` or `WITH`, case-insensitive;
  - contain no other `;`;
  - contain no control characters, `` ` ``, `$` or `&`;
  - contain no single `|` (only `||`, SQL concatenation, is allowed);
  - have no `>` followed, after optional whitespace, by a file location such as `flash:` or `file:`.

  Rejections use `event_monitor_sqlite_rejected`. The first two rules, together with EOS's own one-statement limit, are what exclude `ATTACH`, `VACUUM INTO`, `PRAGMA` and `DETACH`: none of them can follow `WITH` or appear inside a `SELECT`. `INSERT`, `UPDATE` and `DELETE` after `WITH` are refused by the read-only database. `<`, `>` and `||` are allowed, because comparisons and concatenation are ordinary SQL and the device treats them as SQL. A single `|` is SQL bitwise OR, which is rarely needed, so rejecting it costs little and keeps any future pipe parsing from reaching an output modifier such as `tee`.
- **Never start the Event Monitor.** Starting it is configuration and stays out of scope. The eAPI client classifies error 1000 containing "event-monitor not running" as `event_monitor_not_running`, for any tool. **Event Monitor Status** is returned as text, which already says whether the monitor is stopped.
- **No new limits or parsing.** Output stays as `eos_run_show` text, bounded by `maxShowCommandsPerRequest` and `maxResponseSizeBytes`. There is no default row limit; narrowing guidance tells callers to add `limit` or SQL `LIMIT`. `auto` output falls back to text as for any command without JSON.
- **Discoverability.** The `eos_run_show` description says that `show event-monitor` commands run in privileged mode, cannot be mixed with other commands, take `%`-wildcard filters, that sqlite statements must be a single `SELECT` or `WITH`, and that a stopped monitor returns `event_monitor_not_running`.

## Consequences

- `eos_run_show` is no longer always unprivileged. Its rule becomes "unprivileged, except for requests made up entirely of **Privileged Show Commands**", and AGENTS.md must say so.
- On most devices, event-monitor commands return `event_monitor_not_running` until an operator configures `event-monitor`. That is the expected first answer, not a fault.
- The caller must write EOS syntax. A wrong option costs a retry after the device's "Invalid input", which is the price of not hard-coding per-type options that change between releases.
- A forgotten `limit` can return up to `maxResponseSizeBytes`; beyond that the call fails with narrowing guidance. `show ip route` on a large table already behaves this way.
- The SQL guard rejects some harmless statements, such as a string literal containing `;`.
- The guard relies on EOS passing the rest of a `sqlite` line to SQLite. If a future release parsed `|` or `>` there as a pipe or redirect, the single-`|` ban and the file-location rule are what still stop a write. Re-measure on any new release, and on hardware, before calling it qualified.
- **Event SQL Query** output has no header row. Column names come from `sqlite_master.sql`.

## Alternatives considered

- **A dedicated typed tool** (`eos_show_event_monitor` with an **Event Type** enum, filter fields and a default row limit). Better guidance and a simpler privilege rule, but its per-type option table came from one cEOS build, already differs from the manual, and would need code changes whenever EOS adds or changes options. It also adds a tool.
- **A thin dedicated tool** taking the text after `show event-monitor`. Keeps privileged mode out of `eos_run_show`, but adds a tool for no gain in safety over the list above.
- **A caller-visible `enable` or `privileged` input on `eos_run_show`.** Leaves privilege to the caller, which is what this decision rules out.
- **A global, command-derived privilege policy in the eAPI client** shared by all tools. Stronger against internal misuse, but changes ping, packet capture and running-config; it can be layered on later.
- **A per-host `mcp_privileged_show_allowed` variable.** Not needed: the operator setting can turn privileged show commands off everywhere.
- **An operator-extensible list.** Would let configuration grant privileged mode to commands nobody has vetted, such as `show running-config` through `eos_run_show`.
- **Drop `sqlite`.** Safest, but loses joins and aggregates across **Event Types**.
- **Rely on the device's read-only database.** `ATTACH` and `VACUUM INTO` showed that read-only mode does not stop file creation.
- **A keyword deny-list for SQL** (`ATTACH`, `VACUUM`, `PRAGMA`, `INTO`). Redundant given the `SELECT`/`WITH` rule and the one-statement limit, and rejects harmless literals.
- **Block `<`, `>` and `|` in SQL as everywhere else.** Leaves comparisons expressible only through `BETWEEN` and `NOT`.
- **Start the Event Monitor on demand.** Configuration; out of scope permanently.
