# EOS MCP Server Context

This context defines the shared language for policy-controlled access to Arista EOS devices through MCP tools.

## Language

**Log Severity**:
The priority level assigned to an EOS log message, interpreted by logging tools as a minimum threshold when filtering results.
_Avoid_: Severity class, exact severity

**Logging Query**:
A bounded request for EOS log messages, defined by a minimum **Log Severity** and a message-count limit.
_Avoid_: Log search, logging command

## Relationships

- A **Log Severity** filter includes messages at that severity and more urgent severities.
- A **Logging Query** has exactly one minimum **Log Severity** and one message-count limit.

## Example dialogue

> **Dev:** "If the caller asks for warning logs, should errors be included too?"
> **Domain expert:** "Yes — the **Logging Query** uses **Log Severity** as a minimum threshold, so warnings include errors, critical, alerts, and emergencies."

## Flagged ambiguities

- "severity" could mean exact severity or minimum threshold — resolved: logging tool filters use **Log Severity** as a minimum threshold.
