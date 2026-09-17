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
npm unlink -g eos-mcp-server
```

## Package a release artifact

```bash
make pack
```

This performs a clean build and produces `eos-mcp-server-<version>.tgz`, which can be installed with `npm install -g ./eos-mcp-server-<version>.tgz`. `npm pack` also rebuilds through the `prepack` hook.

## Verify changes

```bash
make test
make typecheck
```

The repository's [AGENTS.md](../AGENTS.md) lists all common commands and architectural guidance.
