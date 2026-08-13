# EOS MCP Server Context

This context defines the shared language for policy-controlled access to Arista EOS devices through MCP tools.

## Language

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

- A **Log Severity** filter includes messages at that severity and more urgent severities.
- A **Logging Query** has exactly one minimum **Log Severity** and one message-count limit.
- The **EOS Command Runner** returns command-aligned results: one result for each requested EOS command.
- When requested, **Raw eAPI Payload** detail is attached to each command-aligned result rather than returned as an undifferentiated device-level blob.

## Example dialogue

> **Dev:** "If the caller asks for warning logs, should errors be included too?"
> **Domain expert:** "Yes — the **Logging Query** uses **Log Severity** as a minimum threshold, so warnings include errors, critical, alerts, and emergencies."

## Flagged ambiguities

- "severity" could mean exact severity or minimum threshold — resolved: logging tool filters use **Log Severity** as a minimum threshold.
