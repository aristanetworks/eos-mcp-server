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
Authorization for an inventory host to perform diagnostics, additional to read access. Granted by default; `mcp_diagnostics_allowed: false` opts out, and read denial also denies diagnostics.
_Avoid_: Read permission

**Uncertain Execution Reservation**:
Diagnostic capacity held because an EOS execution's remote completion cannot be confirmed. It is held for that execution's own budget (for ping, `commandTimeoutMs`; for a **Packet Capture**, its window plus a margin) and then frees itself; a late confirmed response frees it sooner. It lives only in the server process that made it. A **Device Time Limit** reply is confirmed completion, so it never leaves one.
_Avoid_: Permanent hold, completed job

**Device Time Limit**:
EOS's own per-request timer (`runCmds.requestTimeout`) stopping a diagnostic command once it has started. EOS returns none of the command's output, but its reply confirms the execution has ended, so the reservation is freed at once. What it means depends on the diagnostic: the expected end of an unfilled **Packet Capture**, but a failure for a ping, which then has no **Reachability Finding**.
_Avoid_: Timeout, HTTP timeout, uncertain completion

**Source Address**:
The local IP address an EOS device uses to originate diagnostic probes within the selected routing context.
_Avoid_: Target address, destination address

**Reachability Finding**:
The conclusion of a completed ping diagnostic: reachable when all probes receive replies, partial when only some do, or unreachable when none do. An unreachable finding does not establish why replies were absent and is distinct from a failure to execute the diagnostic.
_Avoid_: Tool failure, confirmed network outage

**Packet Capture**:
A **Non-configuring Diagnostic** that observes packets sent or received by an EOS device's control plane, up to a requested packet count within a bounded window. It never observes hardware-forwarded transit traffic.
_Avoid_: tcpdump, sniff, trace

**Capture Filter**:
The pcap-filter expression that selects which packets a **Packet Capture** keeps.
_Avoid_: BPF, match, ACL

**Packet Capture Permission**:
Authorization for an inventory host to perform **Packet Captures**, additional to **Diagnostic Permission**. Granted by default; `mcp_packet_capture_allowed: false` opts out, and denial of read or diagnostic access also denies capture.
_Avoid_: Diagnostic permission alone, capture access

**Capture Finding**:
The conclusion of a completed **Packet Capture**: complete when the requested packet count was observed within the window, carrying those packets; unfilled when fewer arrived before the **Device Time Limit** stopped it, carrying none. An unfilled finding is distinct from a failure to execute the capture, such as an invalid **Capture Filter**.
_Avoid_: Timeout, empty capture, no traffic

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
- Permissions form a ladder: read access ⊂ **Diagnostic Permission** ⊂ **Packet Capture Permission**.
- A **Packet Capture** has at most one **Capture Filter** and performs one **Diagnostic Execution** per resolved host, each yielding its own **Capture Finding** or execution failure.
- An unfilled **Capture Finding** says fewer matching packets arrived than requested; it does not say none arrived.
- A **Log Severity** filter includes messages at that severity and more urgent severities.
- A **Logging Query** has exactly one minimum **Log Severity** and one message-count limit.
- The **EOS Command Runner** returns command-aligned results: one result for each requested EOS command.
- When requested, **Raw eAPI Payload** detail is attached to each command-aligned result rather than returned as an undifferentiated device-level blob.

## Example dialogue

> **Dev:** "If the caller asks for warning logs, should errors be included too?"
> **Domain expert:** "Yes — the **Logging Query** uses **Log Severity** as a minimum threshold, so warnings include errors, critical, alerts, and emergencies."

## Flagged ambiguities

- "severity" could mean exact severity or minimum threshold — resolved: logging tool filters use **Log Severity** as a minimum threshold.
