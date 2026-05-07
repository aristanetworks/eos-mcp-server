import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedServerConfig } from "../src/config/schema.js";
import type { EapiConnectionConfig } from "../src/eapi/types.js";
import type { InventoryHostModel, InventoryModel } from "../src/inventory/types.js";

export function buildConfig(overrides: Partial<ResolvedServerConfig> = {}): ResolvedServerConfig {
  return {
    configPath: undefined,
    inventoryPath: "/tmp/inventory.yml",
    enableWrite: false,
    allowDirectConfigFallback: false,
    actor: undefined,
    logFile: undefined,
    caFile: undefined,
    readTimeoutMs: 10_000,
    writeTimeoutMs: 30_000,
    overallOperationTimeoutMs: undefined,
    deviceConcurrency: 5,
    maxReadTargets: 50,
    maxWriteTargets: 10,
    maxShowCommandsPerRequest: 5,
    maxConfigCommandsPerRequest: 20,
    maxResponseSizeBytes: 1_048_576,
    previewMaxAgeMs: 900_000,
    logWriteCommands: false,
    secretEnvPrefixes: ["EOS_MCP_"],
    defaultConnection: {},
    ...overrides
  };
}

export function setTestPasswordEnv(value = "secret", name = "EOS_MCP_PASSWORD"): void {
  process.env[name] = value;
}

export async function writeTempInventory(lines: string[], prefix = "eos-mcp-test-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const filePath = path.join(dir, "inventory.yml");
  await fs.writeFile(filePath, lines.join("\n"));
  return filePath;
}

export function buildConnection(overrides: Partial<EapiConnectionConfig> = {}): EapiConnectionConfig {
  return {
    inventoryHostname: "leaf1",
    endpointHost: "10.0.0.11",
    baseUrl: "https://10.0.0.11:443/command-api",
    username: "admin",
    password: "secret",
    validateCerts: true,
    timeoutMs: 10_000,
    ...overrides
  };
}

export function buildHost(overrides: Partial<InventoryHostModel> = {}): InventoryHostModel {
  return {
    inventoryHostname: "leaf1",
    resolvedEndpoint: "leaf1",
    effectiveVars: {},
    eligible: true,
    readAllowed: true,
    writeAllowed: false,
    ineligibilityReasons: [],
    groupMemberships: [],
    ...overrides
  };
}

export function buildInventoryModel(hostOverrides: Partial<InventoryHostModel> = {}): InventoryModel {
  const host = buildHost(hostOverrides);

  return {
    path: "/tmp/inventory.yml",
    basename: "inventory.yml",
    schemaKind: "simplified-yaml",
    summary: {
      path: "/tmp/inventory.yml",
      basename: "inventory.yml",
      schemaKind: "simplified-yaml",
      totalHostCount: 1,
      totalGroupCount: 1,
      eosEligibleHostCount: host.eligible ? 1 : 0,
      readAllowedHostCount: host.readAllowed ? 1 : 0,
      writeAllowedHostCount: host.writeAllowed ? 1 : 0
    },
    hosts: [host],
    groups: [],
    hostMap: new Map([[host.inventoryHostname, host]]),
    groupMap: new Map()
  };
}
