import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import { ZodError } from "zod";
import type { CliOptions } from "../cli.js";
import { AppError } from "../core/errors.js";
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
    const text = await readConfigFile(resolvedConfigPath);
    const doc = parseDocument(text, { uniqueKeys: true, merge: true, prettyErrors: true });

    if (doc.errors.length > 0) {
      throw new AppError("config_invalid_yaml", `Invalid server config YAML: ${doc.errors.map((error) => error.message).join("; ")}`);
    }

    const raw = doc.toJS();
    fileConfig = parseConfigSchema(() => serverConfigFileSchema.parse(raw), "config_schema_invalid");
  }

  const merged = {
    configPath: resolvedConfigPath,
    inventoryPath: resolveMaybePath(fileConfig.inventory, resolvedConfigPath),
    actor: fileConfig.actor,
    logFile: resolveMaybePath(fileConfig.logFile, resolvedConfigPath),
    caFile: resolveMaybePath(fileConfig.caFile, resolvedConfigPath),
    readTimeoutMs: fileConfig.readTimeoutMs,
    overallOperationTimeoutMs: fileConfig.overallOperationTimeoutMs,
    deviceConcurrency: fileConfig.deviceConcurrency,
    maxReadTargets: fileConfig.maxReadTargets,
    maxShowCommandsPerRequest: fileConfig.maxShowCommandsPerRequest,
    maxLoggingMessagesPerRequest: fileConfig.maxLoggingMessagesPerRequest,
    maxResponseSizeBytes: fileConfig.maxResponseSizeBytes,
    secretEnvPrefixes: fileConfig.secretEnvPrefixes,
    defaultConnection: fileConfig.defaultConnection
  };

  if (options.inventoryPath) {
    merged.inventoryPath = resolvePathFromCwd(options.inventoryPath);
  }
  if (options.actor !== undefined) {
    merged.actor = options.actor;
  }

  return parseConfigSchema(() => resolvedServerConfigSchema.parse(merged), "config_resolved_invalid");
}

async function readConfigFile(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError("config_read_failed", `Failed to read server config ${configPath}: ${message}`, { configPath });
  }
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

function parseConfigSchema<T>(parse: () => T, code: string): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(code, `Invalid server config: ${formatZodIssues(error)}`, {
        issues: error.issues
      });
    }
    throw error;
  }
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
