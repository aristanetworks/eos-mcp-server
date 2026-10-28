import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { openDiagnosticJournal } from "../src/diagnostics/journal.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { EapiClient } from "../src/eapi/client.js";
import { buildConfig, buildInventoryModel } from "./helpers.js";

const call = { target: "leaf1", request: { kind: "ping" as const, destination: "127.0.0.1" } };
const observation = { kind: "ping" as const, output: "3 packets transmitted, 3 received, 0% packet loss, time 2000ms\n" };

async function ledger() {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "eos-persistence-")), "state.sqlite");
  return { file, journal: openDiagnosticJournal(file, "inventory-identity") };
}

describe("durable diagnostic execution", () => {
  it("durably records the exact wire request ID before sending a diagnostic", async () => {
    const { journal } = await ledger();
    const config = buildConfig();
    const postJson = vi.fn(async (_connection, body: string) => {
      const request = JSON.parse(body);
      const committed = journal.load()[0];
      expect(committed?.rpc_request_id).toBe(request.id);
      expect(committed?.reservation_id).toBe(request.id);
      return { ok: true, status: 200, json: async () => ({
        jsonrpc: "2.0", id: request.id, result: [{ output: "" }, { output: observation.output }]
      }), text: async () => "" };
    });
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true,
      effectiveVars: { ansible_user: "admin", ansible_password: "test-password" }
    }), config, new EapiDiagnosticRunner(config, new EapiClient({ postJson })), journal);
    try {
      expect((await executor.execute(call)).summary.success_count).toBe(1);
      expect(journal.load()).toEqual([]);
    } finally { executor.close(); }
  });

  it("does not dispatch when the write-ahead journal is unavailable", async () => {
    const { journal } = await ledger();
    const runner = { execute: vi.fn(async () => observation) };
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), buildConfig(), runner, journal);
    journal.close();
    const result = await executor.execute(call);
    expect(result.results[0]?.error_code).toBe("diagnostic_state_write_failed");
    expect(runner.execute).not.toHaveBeenCalled();
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, storage_error_code: "diagnostic_state_write_failed" });
    await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_state_write_failed" });
    executor.close();
  });

  it("keeps completed work successful when journal failure rejects queued admissions", async () => {
    let saves = 0;
    const journal = {
      load: () => [],
      save: () => { if (++saves > 1) throw new AppError("diagnostic_state_write_failed", "Injected admission failure"); },
      remove: () => undefined,
      close: () => undefined
    };
    let finish!: (value: typeof observation) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const response = new Promise<typeof observation>((resolve) => { finish = resolve; });
    const runner = { execute: vi.fn(() => { started(); return response; }) };
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, runner, journal);
    try {
      const active = executor.execute(call);
      await ready;
      const waiting = [executor.execute(call), executor.execute(call)];
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(executor.getCapacity().queued_count).toBe(2);
      finish(observation);
      expect((await active).summary.success_count).toBe(1);
      for (const result of await Promise.all(waiting)) {
        expect(result.results[0]?.error_code).toBe("diagnostic_state_write_failed");
      }
      expect(runner.execute).toHaveBeenCalledTimes(1);
      expect(executor.getCapacity()).toMatchObject({ active_count: 0, queued_count: 0, available_count: 0, storage_error_code: "diagnostic_state_write_failed" });
    } finally { executor.close(); }
  });

  it("restores lost-response reservations and blocks replacement across restart", async () => {
    const { file, journal } = await ledger();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const before = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, {
      execute: async () => { throw new AppError("eapi_transport_error", "lost"); }
    }, journal);
    await before.execute(call);
    before.close();
    const restored = openDiagnosticJournal(file, "inventory-identity");
    const runner = { execute: vi.fn(async () => observation) };
    const after = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, runner, restored);
    try {
      expect(after.getCapacity()).toMatchObject({ scope: "state-file", available_count: 0, uncertain_count: 1 });
      await expect(after.execute(call)).rejects.toMatchObject({ code: "diagnostic_capacity_uncertain" });
      expect(runner.execute).not.toHaveBeenCalled();
    } finally {
      after.close();
    }
  });

  it("never frees capacity if durable completion cannot be committed", async () => {
    const { file, journal } = await ledger();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, {
      execute: async () => { journal.close(); return observation; }
    }, journal);
    const result = await executor.execute(call);
    expect(result.results[0]?.error_code).toBe("diagnostic_state_write_failed");
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, uncertain_count: 1 });
    executor.close();
    const recovered = openDiagnosticJournal(file, "inventory-identity");
    try { expect(recovered.load()).toHaveLength(1); } finally { recovered.close(); }
  });

  it("preserves active work on shutdown and cannot erase it with a late response after ownership transfers", async () => {
    const { file, journal } = await ledger();
    const config = buildConfig();
    config.diagnostics.deviceConcurrency = 1;
    let finish!: (value: typeof observation) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const response = new Promise<typeof observation>((resolve) => { finish = resolve; });
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), config, { execute: () => { started(); return response; } }, journal);
    const pending = executor.execute(call);
    const aborted = expect(pending).rejects.toMatchObject({ code: "operation_aborted" });
    await ready;
    executor.close();
    await aborted;
    const recovered = openDiagnosticJournal(file, "inventory-identity");
    try {
      expect(recovered.load()).toEqual([expect.objectContaining({ state: "uncertain" })]);
      await expect(executor.execute(call)).rejects.toMatchObject({ code: "diagnostic_state_closed" });
      finish(observation);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(recovered.load()).toHaveLength(1);
    } finally { recovered.close(); }
  });

  it("does not throw from cancellation if persisting uncertainty fails", async () => {
    const { file, journal } = await ledger();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), buildConfig(), {
      execute: (_host, _request, { signal }) => new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    }, journal);
    const controller = new AbortController();
    const pending = executor.execute({ ...call, signal: controller.signal });
    const aborted = expect(pending).rejects.toMatchObject({ code: "operation_aborted" });
    await ready;
    journal.close();
    expect(() => controller.abort()).not.toThrow();
    await aborted;
    expect(executor.getCapacity()).toMatchObject({ available_count: 0, storage_error_code: "diagnostic_state_write_failed" });
    executor.close();
    const recovered = openDiagnosticJournal(file, "inventory-identity");
    try { expect(recovered.load()).toHaveLength(1); } finally { recovered.close(); }
  });

  it("commits a reservation before dispatch and commits completion before freeing it", async () => {
    const { journal } = await ledger();
    try {
      const runner = { execute: async () => {
        expect(journal.load()).toEqual([expect.objectContaining({ inventory_hostname: "leaf1", state: "active" })]);
        return observation;
      } };
      const executor = new DiagnosticExecutor(buildInventoryModel({ diagnosticsAllowed: true }), buildConfig(), runner, journal);
      expect((await executor.execute(call)).summary.success_count).toBe(1);
      expect(journal.load()).toEqual([]);
    } finally {
      journal.close();
    }
  });
});
