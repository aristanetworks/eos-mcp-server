import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import type { InventoryHostModel } from "../inventory/types.js";
import type { EapiConnectionConfig } from "../eapi/types.js";
import { readBoolean, readNonEmptyString, readPositiveInteger } from "../utils/value.js";

export function resolveEapiConnection(
  config: ResolvedServerConfig,
  host: InventoryHostModel
): EapiConnectionConfig {
  const effectiveVars = host.effectiveVars;
  const endpointHost = host.resolvedEndpoint;
  const port =
    readPositiveInteger(effectiveVars.ansible_httpapi_port) ?? config.defaultConnection.ansibleHttpapiPort ?? 443;
  const username =
    readNonEmptyString(effectiveVars.ansible_user) ?? config.defaultConnection.ansibleUser;

  if (!username) {
    throw new AppError("connection_username_missing", `Missing effective username for host ${host.inventoryHostname}`);
  }

  const hostPasswordSources: Array<{ kind: "env" | "literal"; value: string }> = [];
  const passwordEnv = readNonEmptyString(effectiveVars.mcp_password_env);
  const literalPassword = readNonEmptyString(effectiveVars.ansible_password);
  const defaultPasswordEnv = config.defaultConnection.mcpPasswordEnv;

  if (passwordEnv) {
    hostPasswordSources.push({ kind: "env", value: passwordEnv });
  }
  if (literalPassword) {
    hostPasswordSources.push({ kind: "literal", value: literalPassword });
  }

  if (hostPasswordSources.length > 1) {
    throw new AppError(
      "connection_password_source_invalid",
      `Expected exactly one effective password source for host ${host.inventoryHostname}`
    );
  }

  const passwordSource = hostPasswordSources[0] ?? (defaultPasswordEnv ? { kind: "env" as const, value: defaultPasswordEnv } : undefined);
  if (!passwordSource) {
    throw new AppError("connection_password_source_missing", `Missing password source for host ${host.inventoryHostname}`);
  }

  const password =
    passwordSource.kind === "literal"
      ? passwordSource.value
      : resolvePasswordFromEnv(config.secretEnvPrefixes, passwordSource.value, host.inventoryHostname);

  const validateCerts =
    readBoolean(effectiveVars.mcp_validate_certs) ??
    readBoolean(effectiveVars.ansible_httpapi_validate_certs) ??
    config.defaultConnection.mcpValidateCerts ??
    true;

  return {
    inventoryHostname: host.inventoryHostname,
    endpointHost,
    baseUrl: `https://${endpointHost}:${port}/command-api`,
    username,
    password,
    validateCerts,
    ...(config.caFile !== undefined ? { caFile: config.caFile } : {}),
    timeoutMs: config.readTimeoutMs,
    eapiVersion: config.eapiVersion,
    maxResponseSizeBytes: config.maxResponseSizeBytes
  };
}

function resolvePasswordFromEnv(prefixes: string[], envName: string, hostName: string): string {
  if (!prefixes.some((prefix) => envName.startsWith(prefix))) {
    throw new AppError(
      "connection_password_env_prefix_invalid",
      `Password env var ${envName} for host ${hostName} does not match any allowed prefix`
    );
  }

  const value = process.env[envName];
  if (!value) {
    throw new AppError("connection_password_env_missing", `Password env var ${envName} for host ${hostName} is not set`);
  }

  return value;
}
