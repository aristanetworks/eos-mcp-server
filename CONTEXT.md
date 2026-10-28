# EOS MCP Server Context

This context defines the shared language for policy-controlled access to Arista EOS devices through MCP tools.

## Language

**Target**:
An inventory host or group selected as the location where an EOS operation runs.
_Avoid_: Destination, ad hoc device address

**Non-configuring Diagnostic**:
An operational test or observation performed on an EOS device without changing its configuration; it may generate network traffic or expose packet data.
_Avoid_: Passive read, harmless command

**Destination**:
The IPv4 or IPv6 address tested by a diagnostic, which need not belong to an inventory host and is distinct from the **Target** executing the diagnostic.
_Avoid_: Target, device endpoint

**Diagnostic Execution**:
One run of a diagnostic on one inventory host; for ping, against one **Destination**. Each execution holds its own reservation and yields its own result.
_Avoid_: Probe, job

**Diagnostic Permission**:
Explicit authorization for an inventory host to perform diagnostics, additional to read access; read denial also denies diagnostics.
_Avoid_: Read permission, implicit diagnostic access

**Uncertain Execution Reservation**:
Diagnostic capacity held because an EOS execution may still run or start later and its remote completion cannot be confirmed.
_Avoid_: Cooldown, expired job

**Diagnostic Ledger**:
The durable record of unresolved EOS diagnostic executions associated with an inventory identity, preserving **Uncertain Execution Reservations** across server restarts.
_Avoid_: Cooldown cache, completed-job history

**Fencing Attestation**:
An accountable operator's assertion, grounded in independent evidence, that specified EOS diagnostic executions can no longer run, start from an accepted queue, or be replayed. It is an exercise of operator authority, not machine-confirmed EOS completion.
_Avoid_: Timeout proof, quiet-device check, automatic completion

**Operator Release**:
The explicitly authorized removal of selected **Uncertain Execution Reservations** under a matching **Fencing Attestation**, preserving an audit of the authority and evidence relied upon.
_Avoid_: Force-clear, device reset, automatic recovery

**Source Address**:
The local IP address an EOS device uses to originate diagnostic probes within the selected routing context.
_Avoid_: Target address, destination address

**Reachability Finding**:
The conclusion of a completed ping diagnostic: reachable when all probes receive replies, partial when only some do, or unreachable when none do. An unreachable finding does not establish why replies were absent and is distinct from a failure to execute the diagnostic.
_Avoid_: Tool failure, confirmed network outage

**Log Severity**:
The priority level assigned to an EOS log message, interpreted by logging tools as a minimum threshold when filtering results.
_Avoid_: Severity class, exact severity

**Logging Query**:
A bounded request for EOS log messages, defined by a minimum **Log Severity** and a message-count limit.
_Avoid_: Log search, logging command

**EOS Command Runner**:
The module that executes validated EOS commands through eAPI and returns command-aligned results to read-only tools.
_Avoid_: eAPI helper, command service

**Raw eAPI Payload**:
The unmodified eAPI result entry for a single EOS command, exposed only when callers explicitly request diagnostic detail.
_Avoid_: Raw result, raw output

## Relationships

- A ping request names one or more **Destinations** and a **Target**; it performs one **Diagnostic Execution** per resolved host and **Destination**, each producing its own **Reachability Finding** or execution failure.
- A **Log Severity** filter includes messages at that severity and more urgent severities.
- A **Logging Query** has exactly one minimum **Log Severity** and one message-count limit.
- The **EOS Command Runner** returns command-aligned results: one result for each requested EOS command.
- When requested, **Raw eAPI Payload** detail is attached to each command-aligned result rather than returned as an undifferentiated device-level blob.

## Example dialogue

> **Dev:** "If the caller asks for warning logs, should errors be included too?"
> **Domain expert:** "Yes — the **Logging Query** uses **Log Severity** as a minimum threshold, so warnings include errors, critical, alerts, and emergencies."

## Flagged ambiguities

- "severity" could mean exact severity or minimum threshold — resolved: logging tool filters use **Log Severity** as a minimum threshold.
