# Release Checklist

Use this checklist before tagging and publishing a read-only release.

## Versioning

- [ ] Choose the release version.
- [ ] Update `package.json` version.
- [ ] Refresh `package-lock.json` with `npm install --package-lock-only`.
- [ ] Confirm `package.json` and `package-lock.json` versions match.
- [ ] Confirm `CHANGELOG.md` has an entry for the release.

## Validation

- [ ] Run `npm ci` from a clean checkout.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm pack --dry-run` and inspect package contents.
- [ ] Run `INTEGRATION=1 npm test` against the cEOS/containerlab test environment.

## Read-Only Release Scope

- [ ] Confirm startup rejects `enableWrite=true`.
- [ ] Confirm startup rejects `allowDirectConfigFallback=true`.
- [ ] Confirm no write MCP tools are registered.
- [ ] Confirm `eos_get_server_info` reports `runtime_mode: "read-only"`.
- [ ] Confirm read tools work against the integration topology:
  - [ ] `eos_get_server_info`
  - [ ] `eos_list_inventory`
  - [ ] `eos_probe_devices`
  - [ ] `eos_run_show`
  - [ ] `eos_get_facts`
  - [ ] `eos_get_running_config`

## Documentation

- [ ] Confirm `README.md` install, quick start, inventory, TLS, and MCP client examples are current.
- [ ] Confirm `docs/QUICKSTART.md` matches the published package flow.
- [ ] Confirm `docs/EXAMPLES.md` matches supported read-only tools.
- [ ] Confirm `docs/CHECKPOINT.md` accurately reflects release status.
- [ ] Confirm package contents include `README.md`, `CHANGELOG.md`, `docs/`, and `example-inventories/`.

## Package Metadata

- [ ] Confirm `package.json` has correct `repository`, `bugs`, `homepage`, and `keywords`.
- [ ] Confirm the project has an approved `LICENSE` file and matching `package.json` `license` field before public publication.
- [ ] Confirm no local-only files, secrets, lab artifacts, or generated tarballs are tracked.

## GitHub Release

- [ ] Ensure CI is green on the release commit.
- [ ] Create and push the release tag.
- [ ] Create the GitHub release with changelog highlights.
- [ ] Attach the generated `.tgz` only if the release process requires a downloadable artifact.
- [ ] Publish to npm if this release is intended for npm consumers.
- [ ] Smoke-test install from the published artifact:
  - [ ] `eos-mcp-server --version`
  - [ ] `eos-mcp-server --help`
  - [ ] `eos-mcp-server validate-inventory --inventory <inventory.yml> --inventory-only`
