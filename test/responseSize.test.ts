import { describe, expect, it, vi } from "vitest";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { runShow } from "../src/show/runShow.js";
import { getFacts } from "../src/facts/getFacts.js";
import { getRunningConfig } from "../src/configuration/getRunningConfig.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

function configWithResponseLimit(maxResponseSizeBytes: number) {
  return buildConfig({
    maxResponseSizeBytes,
    defaultConnection: {
      ansibleUser: "admin",
      mcpPasswordEnv: "EOS_MCP_PASSWORD"
    }
  });
}

async function buildSingleHostModel() {
  const inventoryPath = await writeTempInventory([
    "vars:",
    "  ansible_network_os: eos",
    "hosts:",
    "  leaf1:",
    "    ansible_host: 10.0.0.11"
  ]);
  return loadInventoryModel(inventoryPath);
}

async function buildGroupModel() {
  const inventoryPath = await writeTempInventory([
    "vars:",
    "  ansible_network_os: eos",
    "groups:",
    "  leafs:",
    "    hosts: [leaf1, leaf2]",
    "hosts:",
    "  leaf1:",
    "    ansible_host: 10.0.0.11",
    "  leaf2:",
    "    ansible_host: 10.0.0.12"
  ]);
  return loadInventoryModel(inventoryPath);
}

describe("response-size enforcement", () => {
  describe("eos_run_show", () => {
    it("rejects when a single device result exceeds the limit", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const largePayload = "x".repeat(10_000);
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: largePayload }]
        }))
      };

      await expect(
        runShow(model, configWithResponseLimit(500), {
          target: "leaf1",
          commands: ["show version"],
          outputFormat: "text"
        }, runner)
      ).rejects.toThrow(/response.size/i);
    });

    it("succeeds when result is under the limit", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: "small" }]
        }))
      };

      const result = await runShow(
        model, configWithResponseLimit(100_000), {
          target: "leaf1",
          commands: ["show version"],
          outputFormat: "text"
        }, runner
      );

      expect(result.summary.success_count).toBe(1);
    });

    it("includes narrowing guidance in the error", async () => {
      setTestPasswordEnv();
      const model = await buildGroupModel();
      const largePayload = "x".repeat(10_000);
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: largePayload }]
        }))
      };

      try {
        await runShow(model, configWithResponseLimit(500), {
          target: "leafs",
          commands: ["show version"],
          outputFormat: "text"
        }, runner);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toHaveProperty("code", "response_size_exceeded");
        expect(error).toHaveProperty("details");
        const details = (error as { details: Record<string, unknown> }).details;
        expect(details.guidance).toBeDefined();
      }
    });
  });

  describe("eos_get_running_config", () => {
    it("rejects when running config text exceeds the limit", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const largeConfig = "interface Ethernet1\n".repeat(5_000);
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: largeConfig }]
        }))
      };

      await expect(
        getRunningConfig(model, configWithResponseLimit(500), { target: "leaf1" }, runner)
      ).rejects.toThrow(/response.size/i);
    });

    it("includes section guidance for running-config size errors", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const largeConfig = "interface Ethernet1\n".repeat(5_000);
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: largeConfig }]
        }))
      };

      try {
        await getRunningConfig(model, configWithResponseLimit(500), { target: "leaf1" }, runner);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toHaveProperty("code", "response_size_exceeded");
        const details = (error as { details: Record<string, unknown> }).details;
        expect(details.guidance).toMatch(/section/i);
      }
    });
  });

  describe("eos_get_facts", () => {
    it("succeeds with normal-sized facts under the limit", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ hostname: "leaf1", version: "4.32.1F" }]
        }))
      };

      const result = await getFacts(
        model, configWithResponseLimit(100_000),
        { target: "leaf1", include_raw: false },
        runner
      );

      expect(result.summary.success_count).toBe(1);
    });

    it("rejects when include_raw produces oversized results", async () => {
      setTestPasswordEnv();
      const model = await buildSingleHostModel();
      const hugeRawPayload: Record<string, unknown> = {
        hostname: "leaf1",
        version: "4.32.1F",
        bigField: "y".repeat(10_000)
      };
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [hugeRawPayload]
        }))
      };

      await expect(
        getFacts(model, configWithResponseLimit(500), { target: "leaf1", include_raw: true }, runner)
      ).rejects.toThrow(/response.size/i);
    });
  });

  describe("aggregate across devices", () => {
    it("rejects when aggregate results exceed the limit even if individual results are small", async () => {
      setTestPasswordEnv();
      const model = await buildGroupModel();
      const mediumPayload = "x".repeat(400);
      const runner = {
        runShowCommands: vi.fn(async () => ({
          result: [{ output: mediumPayload }]
        }))
      };

      await expect(
        runShow(model, configWithResponseLimit(500), {
          target: "leafs",
          commands: ["show version"],
          outputFormat: "text"
        }, runner)
      ).rejects.toThrow(/response.size/i);
    });
  });
});
