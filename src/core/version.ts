import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { name: string; version: string };

export const APP_NAME = packageJson.name;
export const APP_VERSION = packageJson.version;
