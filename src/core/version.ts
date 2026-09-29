import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { bin: Record<string, string>; version: string };

// The npm package name is scoped (@aristanetworks/...); the CLI and MCP server identify as the bin command name.
export const APP_NAME = Object.keys(packageJson.bin)[0] ?? "eos-mcp-server";
export const APP_VERSION = packageJson.version;
