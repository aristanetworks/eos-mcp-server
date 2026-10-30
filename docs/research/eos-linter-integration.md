# eos-linter integration assessment

Researched 2026-10-21. Recommendation: reuse its **EOS-derived grammar and offline matching approach**, but first obtain an EXEC/show-command schema. Its published configuration schema cannot validate this server's general `show` commands.

## Evidence and provenance

The requested [GitHub repository](https://github.com/mitchv85/eos-linter) and its API returned 404 through both the connected GitHub tool and anonymous HTTPS. This does not establish whether it is private, moved, or removed. No repository commit or source tree could be verified.

Instead, inspected the author's published **0.6.4** extension, published **2026-10-16T13:38:47Z**, using [Open VSX metadata](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4), its [manifest](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/package.json), [README](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/readme.md), [changelog](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/changelog.md), and [VSIX](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix). The archive's calculated SHA-256 matched the [published checksum](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.sha256): `959ba0c66e3e96e384b2fc00eeef57cc23600e977540e2d49ab60c1ac0e19c89`. No downloaded JavaScript or build/probe scripts were executed.

## What is reusable

- **TypeScript core.** The manifest's `build:core` bundles `src/core/*.ts` as Node-targeted ESM; the extension bundles `src/extension.ts` as CommonJS, with `vscode` external. No runtime `dependencies` are declared. Development dependencies include TypeScript, esbuild, VS Code types/package tooling and grammar-test libraries. This is compatible in principle with our TypeScript/Node architecture. [Manifest](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/package.json)
- **Grammar rather than command-string lists.** The shipped `out/schema/eos-4.36.2F.json` contains original syntax strings (`s`), compiled expression arrays (`x`), indexes by first keyword, mode transitions, typed placeholders, hidden commands and completion corrections. Example expression tags include sequences (`s`), alternatives (`a`), optional expressions (`o`) and placeholders (`p`). This structure can support both candidate completion and validation. [VSIX, bundled schema](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix)
- **Offline validation and completion.** The README describes mode-aware syntax checks, numeric/address/interface types, abbreviations, and next-token completion mirroring EOS `?`; document-defined names improve suggestions. Runtime bundle inspection found only `require("vscode")`, local schema loading and editor providers; no `runCmds`, `getCommandCompletions`, HTTP client or subprocess module. Ordinary linting does not submit candidate commands to a switch. [README](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/readme.md), [VSIX](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix)
- **Permissive project license.** The packaged MIT license names Copyright 2026 PacketAnglers and requires preservation of its copyright and permission notice when copying substantial portions. [License](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/LICENSE.txt)

## The critical coverage gap

The schema's own `source` metadata states:

```json
{
  "version": "4.36.2F-49692818.4362F (engineering build)",
  "command": "show cli commands all-modes | json",
  "capturedUtc": "2026-09-28T19:09:06Z",
  "excluded": [
    "EnableMode",
    "UnprivMode",
    "GlobalConfigModeWithHistory",
    "ConfigSessionMode"
  ]
}
```

The hidden-command source uses `show cli commands all-modes hidden | json` with the same exclusions. Neither `EnableMode` nor `UnprivMode` exists in the schema's `modes`. The 72 syntax strings starting with `show` are configuration-context forms such as `show pending`, `show active` and `show diff`, not a general operational-command catalog. **Do not use absence from this schema to reject `show bgp ...` or other EXEC commands.** [VSIX, bundled schema](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix)

The schema reports 769 modes, 6,690 syntax strings, 6,512 compiled entries and **201 truncated entries**, plus 209 compiled hidden entries. It is **2,275,374 bytes**, with additional measured platform/type/reference rules. The README identifies EOS 4.36.2F as its baseline and lists per-release schema selection as future work. Validation is therefore version/platform dependent, with incomplete listing coverage and document-local semantics; a syntactically accepted command does not establish correct troubleshooting intent or authorization. [VSIX](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix), [README](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/readme.md)

## Integration shape

These are proposed interfaces, not existing eos-linter exports:

```ts
suggestShowCommands({ target, prefix, limit })
validateShowCommands({ target, commands })
```

Expose them as separate read-only MCP tools, backed by a `commandCatalog` module. Suggestions should return short next-token/syntax results with schema release, platform and coverage. Validation should distinguish `valid`, `invalid`, and `unknown`, including incomplete syntax, expected tokens and unsupported schema coverage. For groups, return device-specific compatibility and require every target to pass any configured enforcement rule.

Keep three separate decisions: **policy allowed**, **grammar valid**, and **appropriate for the investigation**. Our existing [command guard](../../src/eapi/commands.ts) already enforces single-line `show` input and rejects output modifiers/shell metacharacters. Preserve it before catalog matching and execution. [runShow](../../src/show/runShow.ts) provides the service seam before `reader.runShowCommands`; catalog matches must never authorize configuration or other non-show commands. Initial catalog validation should be advisory while coverage is established. Intent-to-command recommendations still need curated troubleshooting guidance.

Prefer extracting or obtaining an upstream library with maintained parser/compiler APIs over importing the VS Code extension. The VSIX exports only `activate` and `deactivate`; core functions are bundled and minified, and its schema loader explicitly requires `GlobalConfigMode` and transitions. The manifest has no library exports, CLI linter or service protocol. Source access is needed to verify separable modules, exact signatures and test contracts before implementation. [Manifest](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/package.json), [VSIX](https://open-vsx.org/api/PacketAnglers/eos-linter/0.6.4/file/PacketAnglers.eos-linter-0.6.4.vsix)

## Smallest useful experiment

1. On a lab device, capture the EXEC/`EnableMode` command listing and confirm it includes representative `show version`, BGP, interfaces and routing syntaxes. Test the trusted discovery command `show cli commands all-modes` using eAPI JSON format, since our public guard rejects `| json`. Listing availability, required privilege and eAPI JSON support remain unverified; the connection attempts below did not return command results.
2. Extract a bounded show-only catalog; check whether its syntax fits the linter's expression compiler, especially truncated strings, dynamic placeholders and abbreviations. Compare accepted, incomplete and refused examples against that EOS release without automatically executing arbitrary candidates.
3. Prototype offline prefix completion and advisory validation. Pin schema provenance; key live caches by device/release/platform and credential role, with a TTL. Never return the full catalog through MCP: the existing config schema alone exceeds our default 1 MB response limit. Preserve target resolution, timeouts, limits and `AppError` handling.
4. Treat config auditing as a separate possible read-only feature using `eos_get_running_config` output. That fits the published schema more directly, but it does not solve operational command discovery and requires full-document/version caveats.

Do not implement validation by passing a candidate to eAPI `runCmds`: that executes it. The linter's lab oracle/probe scripts built its evidence; they are not the offline validation runtime and were not available for source review. A community [eAPI tutorial](https://github.com/arista-netdevops-community/arista_eos_automation_with_eAPI#the-getcommandcompletions-method) describes `getCommandCompletions`, but labels those methods informational and advises using only `runCmds`; completion RPC should remain a separate lab investigation, not an assumed supported production API.

## Containerlab validation scope

The user confirmed that containerized EOS is available for testing and that some commands supported on physical devices may be absent in cEOS. A cEOS-derived catalog must therefore describe its observed platform and release; it cannot be a universal EOS allowlist. Missing catalog entries should produce `unknown` outside that catalog's coverage. A command refused by a cEOS device establishes only that target's observed behavior, not that physical EOS refuses it. Syntax matching also does not establish feature configuration, hardware availability, privileges or JSON output support.

Use cEOS for parser/completion integration and supported read-path smoke checks. Keep physical-device command fixtures as separate evidence with release/model provenance, and leave hardware-specific behavior unverified until tested on a suitable device. Distinguish syntax results from operational failures; connectivity or authentication errors provide no evidence about command validity.

Local checks on 2026-10-21 found eight running containers using image `ceos-lab:4.34.3M`. The connected MCP inventory's `arista_ceos` group matches their names and management addresses; Docker inspection confirmed `node1-1` at `172.20.20.11` and `node2-1` at `172.20.20.21`. MCP requests for facts and `show cli commands` in JSON format returned `eapi_transport_error` / `EHOSTUNREACH` on these two targets. No command listing or device-reported EOS version was obtained. Connectivity from the MCP server must be established before drawing command-support conclusions. These checks did not change device configuration.
