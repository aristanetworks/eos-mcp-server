import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import type { CliOptions } from "../cli.js";
import { resolvePathFromConfig, resolvePathFromCwd } from "../utils/path.js";
import {
  resolvedServerConfigSchema,
  serverConfigFileSchema,
  type ResolvedServerConfig,
  type ServerConfigFile
} from "./schema.js";

export async function loadServerConfig(options: CliOptions): Promise<ResolvedServerConfig> {
  let fileConfig: ServerConfigFile = {};
  let resolvedConfigPath: string | undefined;

  if (options.configPath) {
    resolvedConfigPath = resolvePathFromCwd(options.configPath);
    const text = await fs.readFile(resolvedConfigPath, "utf8");
    const doc = parseDocument(text, { uniqueKeys: true, merge: true, prettyErrors: true });

    if (doc.errors.length > 0) {
      throw new Error(`Invalid server config YAML: ${doc.errors.map((error) => error.message).join("; ")}`);
    }

    const raw = doc.toJS();
    fileConfig = serverConfigFileSchema.parse(raw);
  }

  const merged = {
    configPath: resolvedConfigPath,
    inventoryPath: resolveMaybePath(fileConfig.inventory, resolvedConfigPath),
    enableWrite: fileConfig.enableWrite,
    allowDirectConfigFallback: fileConfig.allowDirectConfigFallback,
    actor: fileConfig.actor,
    logFile: resolveMaybePath(fileConfig.logFile, resolvedConfigPath),
    caFile: resolveMaybePath(fileConfig.caFile, resolvedConfigPath),
    readTimeoutMs: fileConfig.readTimeoutMs,
    writeTimeoutMs: fileConfig.writeTimeoutMs,
    overallOperationTimeoutMs: fileConfig.overallOperationTimeoutMs,
    deviceConcurrency: fileConfig.deviceConcurrency,
    maxReadTargets: fileConfig.maxReadTargets,
    maxWriteTargets: fileConfig.maxWriteTargets,
    maxShowCommandsPerRequest: fileConfig.maxShowCommandsPerRequest,
    maxConfigCommandsPerRequest: fileConfig.maxConfigCommandsPerRequest,
    previewMaxAgeMs: fileConfig.previewMaxAgeMs,
    logWriteCommands: fileConfig.logWriteCommands,
    secretEnvPrefixes: fileConfig.secretEnvPrefixes,
    defaultConnection: fileConfig.defaultConnection
  };

  if (options.inventoryPath) {
    merged.inventoryPath = resolvePathFromCwd(options.inventoryPath);
  }
  if (options.enableWrite !== undefined) {
    merged.enableWrite = options.enableWrite;
  }
  if (options.allowDirectConfigFallback !== undefined) {
    merged.allowDirectConfigFallback = options.allowDirectConfigFallback;
  }
  if (options.actor !== undefined) {
    merged.actor = options.actor;
  }

  return resolvedServerConfigSchema.parse(merged);
}

function resolveMaybePath(value: string | undefined, configPath: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (!configPath) {
    return resolvePathFromCwd(value);
  }

  return resolvePathFromConfig(configPath, value);
}
