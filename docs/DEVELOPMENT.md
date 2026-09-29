# Developer workflow

This guide is for contributors and for users who need to build `eos-mcp-server` from a source checkout. For a normal installation, download a package from the [latest GitHub release](https://github.com/aristanetworks/eos-mcp-server/releases/latest) and follow the [README](../README.md).

## Requirements

- Node.js 24+
- npm

## Build from source

From the repository root:

```bash
npm install
make build
```

Run the built CLI directly:

```bash
node dist/index.js serve --inventory path/to/inventory.yml
```

For development without compiling first:

```bash
npm run dev -- serve --inventory path/to/inventory.yml
```

## Make a local installation

To expose the command from a checkout:

```bash
npm install
make build
npm link
```

Or install the checkout directly:

```bash
npm install -g /absolute/path/to/eos-mcp-server
```

Remove a linked installation later with:

```bash
npm unlink -g @aristanetworks/eos-mcp-server
```

## Package a release artifact

```bash
make pack
```

This performs a clean build and produces `aristanetworks-eos-mcp-server-<version>.tgz`, which can be installed with `npm install -g ./aristanetworks-eos-mcp-server-<version>.tgz`. `npm pack` also rebuilds through the `prepack` hook.

## Publish to npm

The package is published as `@aristanetworks/eos-mcp-server`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which tests, packs, publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no token secret), and creates the GitHub release. Tags containing `-alpha`, `-beta`, or `-rc` publish under the `next` dist-tag; other tags publish as `latest`. Published versions carry npm provenance attestations.

## Verify changes

```bash
make test
make typecheck
```

The repository's [AGENTS.md](../AGENTS.md) lists all common commands and architectural guidance.
