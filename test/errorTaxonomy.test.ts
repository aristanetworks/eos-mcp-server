import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { runShow } from "../src/show/runShow.js";
import { buildConfig, setTestPasswordEnv, writeTempInventory } from "./helpers.js";

describe("error taxonomy", () => {
  describe("inventory errors", () => {
    it("uses inventory_validation_failed code for invalid inventory", async () => {
      const inventoryPath = await writeTempInventory(["not: a: valid: inventory: file"]);
      try {
        await loadInventoryModel(inventoryPath);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toMatch(/^inventory_/);
      }
    });
  });

  describe("read-path errors", () => {
    it("uses show_command_invalid code for non-show commands", async () => {
      setTestPasswordEnv();
      const model = await loadInventoryModel(
        await writeTempInventory([
          "hosts:",
          "  leaf1:",
          "    ansible_host: 10.0.0.11",
          "    ansible_network_os: eos"
        ])
      );

      try {
        await runShow(
          model,
          buildConfig({
            defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
          }),
          { target: "leaf1", commands: ["configure terminal"], outputFormat: "auto" },
          { runShowCommands: vi.fn() }
        );
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("show_command_invalid");
      }
    });

    it("uses read_target_limit_exceeded code when exceeding maxReadTargets", async () => {
      setTestPasswordEnv();
      const model = await loadInventoryModel(
        await writeTempInventory([
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
        ])
      );

      try {
        await runShow(
          model,
          buildConfig({
            maxReadTargets: 1,
            defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
          }),
          { target: "leafs", commands: ["show version"], outputFormat: "auto" },
          { runShowCommands: vi.fn() }
        );
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("read_target_limit_exceeded");
      }
    });

    it("uses show_command_limit_exceeded code when exceeding maxShowCommandsPerRequest", async () => {
      setTestPasswordEnv();
      const model = await loadInventoryModel(
        await writeTempInventory([
          "hosts:",
          "  leaf1:",
          "    ansible_host: 10.0.0.11",
          "    ansible_network_os: eos"
        ])
      );

      try {
        await runShow(
          model,
          buildConfig({
            maxShowCommandsPerRequest: 1,
            defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
          }),
          { target: "leaf1", commands: ["show version", "show hostname"], outputFormat: "auto" },
          { runShowCommands: vi.fn() }
        );
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("show_command_limit_exceeded");
      }
    });

    it("uses response_size_exceeded code with details when response is too large", async () => {
      setTestPasswordEnv();
      const model = await loadInventoryModel(
        await writeTempInventory([
          "hosts:",
          "  leaf1:",
          "    ansible_host: 10.0.0.11",
          "    ansible_network_os: eos"
        ])
      );

      try {
        await runShow(
          model,
          buildConfig({
            maxResponseSizeBytes: 100,
            defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" }
          }),
          { target: "leaf1", commands: ["show version"], outputFormat: "text" },
          { runShowCommands: vi.fn(async () => ({ result: [{ output: "x".repeat(1000) }] })) }
        );
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe("response_size_exceeded");
        expect(appError.details).toBeDefined();
        expect(appError.details!.guidance).toBeDefined();
        expect(appError.details!.responseSizeBytes).toBeGreaterThan(100);
      }
    });
  });
});
