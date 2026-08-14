import net from "node:net";
import { beforeAll, describe, expect, it } from "vitest";
import { getRunningConfig } from "../src/configuration/getRunningConfig.js";
import { EapiDeviceReader, type EosDeviceReader } from "../src/connection/eosDeviceReader.js";
import { EapiClient } from "../src/eapi/client.js";
import { getFacts } from "../src/facts/getFacts.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import type { InventoryModel } from "../src/inventory/types.js";
import { probeDevices } from "../src/probe/probeDevices.js";
import { runShow } from "../src/show/runShow.js";
import { showLogging } from "../src/logging/showLogging.js";
import type { ResolvedServerConfig } from "../src/config/schema.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

const HOST_NAMES = [
  "clab-testlab-node1-1",
  "clab-testlab-node1-2",
  "clab-testlab-node2-1",
  "clab-testlab-node2-2",
  "clab-testlab-node2-3",
  "clab-testlab-node2-4",
  "clab-testlab-node2-5",
  "clab-testlab-node2-6"
] as const;
const SINGLE_HOST = HOST_NAMES[0];
const GROUP_NAME = "arista_ceos";
const TOTAL_HOSTS = HOST_NAMES.length;

const INTEGRATION = process.env.INTEGRATION === "1";

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe.runIf(INTEGRATION)("integration: EOS read-path tools", () => {
  let model: InventoryModel;
  let config: ResolvedServerConfig;
  let runner: EosDeviceReader;

  beforeAll(async () => {
    const reachable = await tcpProbe(SINGLE_HOST, 443, 5_000);
    if (!reachable) {
      throw new Error(
        `clab device ${SINGLE_HOST} unreachable by hostname at ${SINGLE_HOST}:443 -- is containerlab running and are clab hostnames resolvable?`
      );
    }

    const inventoryPath = await writeTempInventory([
      "all:",
      "  children:",
      `    ${GROUP_NAME}:`,
      "      vars:",
      "        ansible_user: admin",
      "        ansible_password: admin",
      "        ansible_network_os: eos",
      "        mcp_validate_certs: false",
      "      hosts:",
      ...HOST_NAMES.map((host) => `        ${host}: {}`)
    ], "eos-mcp-integration-");

    model = await loadInventoryModel(inventoryPath);
    config = buildConfig();
    runner = new EapiDeviceReader(config, new EapiClient());
  }, 30_000);

  it("probes a single host successfully", async () => {
    const result = await probeDevices(model, config, { target: SINGLE_HOST, include_raw: true }, runner);

    expect(result.target).toBe(SINGLE_HOST);
    expect(result.target_type).toBe("host");
    expect(result.resolved_devices).toEqual([SINGLE_HOST]);
    expect(result.summary.total_count).toBe(1);
    expect(result.summary.success_count).toBe(1);
    expect(result.summary.failed_count).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("success");
    expect(result.results[0]?.inventory_hostname).toBe(SINGLE_HOST);
    expect(result.results[0]?.resolved_endpoint).toBe(SINGLE_HOST);
    expect(result.results[0]?.command_results?.[0]?.raw_entry).toBeDefined();
  }, 30_000);

  it("probes all devices in a group", async () => {
    const result = await probeDevices(model, config, { target: GROUP_NAME, include_raw: false }, runner);

    expect(result.target_type).toBe("group");
    expect(result.resolved_devices).toHaveLength(TOTAL_HOSTS);
    expect(result.summary.total_count).toBe(TOTAL_HOSTS);
    expect(result.summary.success_count).toBe(TOTAL_HOSTS);
    expect(result.summary.failed_count).toBe(0);

    for (const deviceResult of result.results) {
      expect(deviceResult.status).toBe("success");
    }
  }, 60_000);

  it("runs show version in json format on a single host", async () => {
    const result = await runShow(
      model,
      config,
      { target: SINGLE_HOST, commands: ["show version"], outputFormat: "json" },
      runner
    );

    expect(result.summary.success_count).toBe(1);
    expect(result.requested_output_format).toBe("json");

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.actual_output_format).toBe("json");
    expect(deviceResult?.command_results).toBeDefined();

    const commandResults = deviceResult?.command_results;
    expect(commandResults).toHaveLength(1);
    expect(commandResults?.[0]?.command).toBe("show version");
    expect(typeof (commandResults?.[0]?.output as Record<string, unknown>)?.version).toBe("string");
  }, 30_000);

  it("runs show version in text format on a single host", async () => {
    const result = await runShow(
      model,
      config,
      { target: SINGLE_HOST, commands: ["show version"], outputFormat: "text" },
      runner
    );

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.actual_output_format).toBe("text");

    const commandResults = deviceResult?.command_results;
    expect(commandResults?.[0]?.output).toMatch(/Arista|Software image version/i);
  }, 30_000);

  it("falls back from json to text in auto mode for text-only show output", async () => {
    const result = await runShow(
      model,
      config,
      { target: SINGLE_HOST, commands: ["show logging threshold warnings 10"], outputFormat: "auto" },
      runner
    );

    expect(result.requested_output_format).toBe("auto");

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.actual_output_format).toBe("text");

    const commandResult = deviceResult?.command_results?.[0];
    expect(commandResult?.command).toBe("show logging threshold warnings 10");
    expect(commandResult?.output_format).toBe("text");
    expect(typeof commandResult?.output).toBe("string");
  }, 30_000);

  it("runs multiple show commands on a single host", async () => {
    const result = await runShow(
      model,
      config,
      { target: SINGLE_HOST, commands: ["show version", "show hostname"], outputFormat: "json" },
      runner
    );

    expect(result.summary.success_count).toBe(1);

    const commandResults = result.results[0]?.command_results;
    expect(commandResults).toHaveLength(2);
  }, 30_000);

  it("retrieves bounded logging output for a single host", async () => {
    const result = await showLogging(
      model,
      config,
      {
        target: SINGLE_HOST,
        minimumSeverity: "warnings",
        messageCount: 10
      },
      runner
    );

    expect(result.target).toBe(SINGLE_HOST);
    expect(result.target_type).toBe("host");
    expect(result.minimum_severity).toBe("warnings");
    expect(result.message_count).toBe(10);
    expect(result.resolved_devices).toEqual([SINGLE_HOST]);
    expect(result.summary.total_count).toBe(1);
    expect(result.summary.success_count).toBe(1);
    expect(result.summary.failed_count).toBe(0);

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.inventory_hostname).toBe(SINGLE_HOST);
    expect(deviceResult?.resolved_endpoint).toBe(SINGLE_HOST);
    expect(deviceResult?.command).toBe("show logging threshold warnings 10");
    expect(typeof deviceResult?.log_text).toBe("string");
  }, 30_000);

  it("gets facts for a single host", async () => {
    const result = await getFacts(
      model,
      config,
      { target: SINGLE_HOST, include_raw: false },
      runner
    );

    expect(result.summary.success_count).toBe(1);

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.facts).toBeDefined();

    const facts = deviceResult!.facts!;
    expect(facts.inventory_hostname).toBe(SINGLE_HOST);
    expect(typeof facts.eos_version).toBe("string");
    expect((facts.eos_version as string).length).toBeGreaterThan(0);
    expect(typeof facts.model).toBe("string");
    expect(typeof facts.system_mac).toBe("string");
    expect(deviceResult?.command_results).toBeUndefined();
  }, 30_000);

  it("gets facts with include_raw=true", async () => {
    const result = await getFacts(
      model,
      config,
      { target: SINGLE_HOST, include_raw: true },
      runner
    );

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(deviceResult?.facts).toBeDefined();
    expect(deviceResult?.command_results?.[0]?.raw_entry).toBeDefined();
  }, 30_000);

  it("gets full running config for a single host", async () => {
    const result = await getRunningConfig(model, config, { target: SINGLE_HOST }, runner);

    expect(result.summary.success_count).toBe(1);
    expect(result.section_requested).toBeNull();

    const deviceResult = result.results[0];
    expect(deviceResult?.status).toBe("success");
    expect(typeof deviceResult?.config_text).toBe("string");
    expect((deviceResult?.config_text as string).length).toBeGreaterThan(0);
    expect(deviceResult?.config_text).toMatch(/hostname/i);
  }, 30_000);

  it("gets running config with a section filter", async () => {
    const result = await getRunningConfig(
      model,
      config,
      { target: SINGLE_HOST, section: "hostname" },
      runner
    );

    expect(result.section_requested).toBe("hostname");
    expect(result.results[0]?.status).toBe("success");
    expect(typeof result.results[0]?.config_text).toBe("string");
  }, 30_000);

  it("rejects group running config without a section", async () => {
    await expect(
      getRunningConfig(model, config, { target: GROUP_NAME }, runner)
    ).rejects.toThrow(/section/i);
  }, 5_000);

  it("rejects non-show commands", async () => {
    await expect(
      runShow(
        model,
        config,
        { target: SINGLE_HOST, commands: ["configure terminal"], outputFormat: "json" },
        runner
      )
    ).rejects.toThrow(/show/i);
  }, 5_000);
});
