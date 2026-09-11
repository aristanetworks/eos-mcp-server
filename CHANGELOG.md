# Changelog

## 0.6.0-beta

- Refactoring EapiDeviceReader to hide connection information

## 0.5.3-beta

- Upgrades Node.js requirement to v24 LTS (Krypton).
- Updates GitHub Actions workflows to use Node 24/26.
- Refactoring how json/text outputs are handled.
- Removes configuration-changing scaffolding; the server is permanently read-only.

## 0.5.2-beta

- Refreshes the `qs` transitive dependency lock to clear the current `npm audit` finding.
- Adds fail-closed validation for known security-sensitive inventory variable types before effective policy evaluation.

## 0.5.1-beta

- Fixes `eos_run_show` being advertised with an empty input schema by moving its `command` XOR `commands` validation from a Zod `.superRefine()` into the tool handler; the wrapping `ZodEffects` was hiding `.shape` from the MCP SDK's schema normalizer, leaving callers unable to pass arguments.
- Adds a stdio smoke regression that asserts every tool with arguments advertises a non-empty `inputSchema.properties` containing `target`.
- Refactors logging request validation and EOS logging command construction into a dedicated Logging Query module.

## 0.5.0-beta

- Adds `eos_show_logging` for bounded, threshold-filtered EOS logging retrieval.
- Adds `maxLoggingMessagesPerRequest` config and exposes it through server info.
- Updates integration tests to resolve containerlab devices by hostname instead of ephemeral IPs.

## 0.4.0-beta

- Hardens eAPI response handling with invalid-JSON errors and runCmds result-count validation.
- Centralizes final read-tool response-size enforcement on the shared result envelope so tool-specific metadata is included in the limit check.
- Refactors inventory model construction into focused effective-vars, graph, and access-policy modules.
- Refactors MCP tool registration into shared tool definitions.
- Improves config file read failures with machine-readable `AppError` details.
- Sanitizes packaged example inventories and release documentation for public distribution.
- Refreshes transitive dependency locks to clear `npm audit` findings.
- Adds regression coverage for shared final-envelope response-size enforcement.

## 0.3.0-alpha

- Ships the Phase 1 read-only MCP server for Arista EOS eAPI.
- Adds read-only MCP tools for server info, inventory listing, probing, show commands, facts, and running-config retrieval.
- Adds strict inventory validation, fail-closed target resolution, startup connection validation, response-size limits, and read-operation timeout handling.
- Adds CLI commands for serving over stdio, validating inventory, printing server info, and probing targets.
