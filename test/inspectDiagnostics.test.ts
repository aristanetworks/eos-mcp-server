import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { StatementSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { runInspectDiagnostics } from "../src/commands/inspectDiagnostics.js";
import { inspectDiagnosticJournal, openDiagnosticJournal, releaseDiagnosticReservations } from "../src/diagnostics/journal.js";
import { defaultDiagnosticStateFile, diagnosticInventoryIdentity } from "../src/diagnostics/statePath.js";
import { buildConfig } from "./helpers.js";
import { operatorReleaseFixture } from "./fixtures/operatorRelease.js";

const reservation = { reservation_id: "inspect-test", inventory_hostname: "leaf1", diagnostic: "ping" as const, state: "active" as const, reserved_at: "2026-10-27T00:00:00.000Z" };

describe("offline diagnostic inspection", () => {
  it("runs through the real CLI without an inventory or device credentials", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eos-inspect-cli-"));
    const file = path.join(directory, "state.sqlite");
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.close();
    const config = path.join(directory, "config.yml");
    await fs.writeFile(config, `diagnostics:\n  stateFile: ${JSON.stringify(file)}\n`);
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "src/index.ts", "inspect-diagnostics", "--config", config, "--json"]);
    expect(JSON.parse(stdout)).toMatchObject({ unresolved_count: 1, reservations: [reservation] });
  });

  it("inspects a live ledger without credential resolution, takeover, or record changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eos-inspect-"));
    const file = path.join(directory, "state.sqlite");
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    const config = buildConfig({ inventoryPath: undefined });
    config.diagnostics.stateFile = file;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await runInspectDiagnostics(config, true)).toBe(0);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ unresolved_count: 1, reservations: [reservation] });
      expect(inspectDiagnosticJournal(file).reservations).toEqual([reservation]);
      log.mockClear();
      expect(await runInspectDiagnostics(config, false)).toBe(0);
      expect(log.mock.calls.map((call) => String(call[0])).join("\n")).toContain("RPC ID: (not recorded)");
    } finally { log.mockRestore(); journal.close(); }
  });

  it("never mixes unresolved reservations with a concurrently committed release audit", async () => {
    const { file, id, otherId, evidence } = await operatorReleaseFixture();
    let attempted = false;
    let releaseError: unknown;
    const all = StatementSync.prototype.all;
    // Interleave a real second-connection release immediately after the first
    // reservation read, without replacing SQLite reads or adding production hooks.
    const hook = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (this: StatementSync, ...parameters: Parameters<StatementSync["all"]>) {
      const rows = all.apply(this, parameters);
      if (!attempted && rows.some((row) => row.reservation_id === id)) {
        attempted = true;
        try {
          releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true });
        } catch (error) { releaseError = error; }
      }
      return rows;
    });
    try {
      const during = inspectDiagnosticJournal(file);
      expect(attempted).toBe(true);
      expect(during.reservations.map((record) => record.reservation_id).sort()).toEqual([id, otherId].sort());
      expect(during.release_audit.length).toBe(0);
    } finally { hook.mockRestore(); }
    // A rollback-journal writer may fail closed while the read snapshot is held.
    // It must succeed once inspection has ended, with one audit and no mixed state.
    if (releaseError !== undefined) {
      expect(releaseError).toMatchObject({ code: expect.stringMatching(/^diagnostic_(state_in_use|release_failed)$/) });
      releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true });
    }
    const after = inspectDiagnosticJournal(file);
    expect(after.reservations.map((record) => record.reservation_id)).toEqual([otherId]);
    expect(after.release_audit).toHaveLength(1);
    expect(after.release_audit[0]?.released_reservations.map((record) => record.reservation_id)).toEqual([id]);
  });

  it("does not create fresh state when inspection finds a missing ledger", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eos-inspect-missing-"));
    const file = path.join(directory, "missing.sqlite");
    const config = buildConfig({ inventoryPath: undefined });
    config.diagnostics.stateFile = file;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await runInspectDiagnostics(config, true)).toBe(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toHaveProperty("error_code", "diagnostic_state_invalid");
      await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { log.mockRestore(); }
  });

  it.skipIf(process.platform === "win32")("uses canonical inventory identity so path aliases share the default ledger", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eos-identity-"));
    const file = path.join(directory, "inventory.yml");
    const alias = path.join(directory, "alias.yml");
    await fs.writeFile(file, "hosts: {}\n");
    await fs.symlink(file, alias);
    expect(diagnosticInventoryIdentity(alias)).toBe(diagnosticInventoryIdentity(file));
    expect(defaultDiagnosticStateFile(alias)).toBe(defaultDiagnosticStateFile(file));
  });
});
