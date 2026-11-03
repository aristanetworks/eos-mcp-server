import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi, type Mock } from "vitest";
import type { ResolvedServerConfig } from "../src/config/schema.js";
import { diagnosticsConfigSchema } from "../src/config/diagnostics.js";
import type { EosDeviceReader } from "../src/connection/eosDeviceReader.js";
import type { DiagnosticDeviceRunner, DiagnosticObservation, PreparedDiagnostic } from "../src/diagnostics/types.js";
import type { EapiConnectionConfig, EosCommandRunner } from "../src/eapi/types.js";
import type { EapiTransport } from "../src/eapi/transport.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import type { InventoryHostModel, InventoryModel } from "../src/inventory/types.js";
import { EapiSlots, eapiSlotLimits } from "../src/operations/eapiSlots.js";

/** Fixture EOS server: echo protocol identity around abbreviated result/error payloads.
 * Explicit fields override defaults; missing-envelope tests must use a raw transport.
 */
export function echoRpcTransport(transport: EapiTransport): EapiTransport {
  return {
    async postJson(connection, requestJson, signal) {
      const response = await transport.postJson(connection, requestJson, signal);
      return {
        ...response,
        async json() {
          const payload = await response.json();
          if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
          return { jsonrpc: "2.0", id: JSON.parse(requestJson).id as unknown, ...payload };
        }
      };
    }
  };
}

/** `EosDeviceReader.runShowCommands` mock typed against the real signature, so fixture
 * results keep literal `output_format` values and `mock.calls` entries are typed.
 */
export function mockRunShowCommands(
  implementation?: EosDeviceReader["runShowCommands"]
): Mock<EosDeviceReader["runShowCommands"]> {
  return vi.fn<EosDeviceReader["runShowCommands"]>(implementation);
}

export function buildConfig(overrides: Partial<ResolvedServerConfig> = {}): ResolvedServerConfig {
  return {
    configPath: undefined,
    inventoryPath: "/tmp/inventory.yml",
    actor: undefined,
    logFile: undefined,
    caFile: undefined,
    diagnostics: diagnosticsConfigSchema.parse({}),
    readTimeoutMs: 10_000,
    overallOperationTimeoutMs: undefined,
    deviceConcurrency: 3,
    readFanOut: 10,
    maxReadTargets: 50,
    maxShowCommandsPerRequest: 5,
    maxLoggingMessagesPerRequest: 1000,
    maxResponseSizeBytes: 1_048_576,
    eapiVersion: "latest",
    secretEnvPrefixes: ["EOS_MCP_"],
    defaultConnection: {},
    ...overrides
  };
}

/** The shared eAPI slots a server would build from `config`. */
export function buildEapiSlots(config: ResolvedServerConfig = buildConfig()): EapiSlots {
  return new EapiSlots(eapiSlotLimits(config));
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
    eapiVersion: "latest",
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
    diagnosticsAllowed: false,
    packetCaptureAllowed: false,
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
      readAllowedHostCount: host.readAllowed ? 1 : 0
    },
    hosts: [host],
    groups: [],
    hostMap: new Map([[host.inventoryHostname, host]]),
    groupMap: new Map()
  };
}

/** A ping whose three probes were all answered. */
export const pingObservation: DiagnosticObservation = {
  kind: "ping",
  output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n"
};

/** Runner that answers every execution with `observation`. */
export function stubDiagnosticRunner(observation: DiagnosticObservation = pingObservation) {
  return { execute: vi.fn<DiagnosticDeviceRunner["execute"]>(async () => observation) };
}

/** EOS hosts leaf1 and leaf2 in group `switches`, allowed diagnostics. `vars` adds inherited vars,
 * and `leaf2Vars` adds vars to leaf2 only.
 */
export async function loadSwitchesModel(options: { vars?: string[]; leaf2Vars?: string[] } = {}): Promise<InventoryModel> {
  return loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  mcp_diagnostics_allowed: true", ...(options.vars ?? []).map((line) => `  ${line}`),
    "hosts:", "  leaf1: {}", "  leaf2:", "    ansible_host: leaf2", ...(options.leaf2Vars ?? []).map((line) => `    ${line}`),
    "groups:", "  switches:", "    hosts: [leaf2, leaf1]"
  ]));
}

/** A device request held pending until the test settles or fails it. */
export interface DispatchedRequest {
  hostname: string;
  kind: PreparedDiagnostic["kind"] | "read";
  settle: () => void;
  fail: (error: Error) => void;
}

/** Diagnostic runner whose executions stay pending in `dispatched`, in dispatch order, until settled
 * with `observationFor(execution)`.
 */
export function controlledDiagnosticRunner(
  observationFor: (execution: PreparedDiagnostic) => DiagnosticObservation = () => pingObservation,
  dispatched: DispatchedRequest[] = []
): { runner: DiagnosticDeviceRunner; dispatched: DispatchedRequest[] } {
  const runner: DiagnosticDeviceRunner = {
    execute: (host, execution) => new Promise<DiagnosticObservation>((resolve, reject) => {
      dispatched.push({ hostname: host.inventoryHostname, kind: execution.kind, settle: () => resolve(observationFor(execution)), fail: reject });
    })
  };
  return { runner, dispatched };
}

/** Read runner whose requests stay pending in `dispatched`, in dispatch order, until settled with an empty `show version`. */
export function controlledReadRunner(dispatched: DispatchedRequest[] = []): { runner: EosCommandRunner; dispatched: DispatchedRequest[] } {
  const runner: EosCommandRunner = {
    runShowCommands: (connection) => new Promise((resolve, reject) => {
      dispatched.push({
        hostname: connection.inventoryHostname, kind: "read",
        settle: () => resolve([{ command: "show version", output_format: "json", output: {} }]), fail: reject
      });
    })
  };
  return { runner, dispatched };
}
