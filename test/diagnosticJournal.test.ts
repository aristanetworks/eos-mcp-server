import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { inspectDiagnosticJournal, openDiagnosticJournal } from "../src/diagnostics/journal.js";

async function stateFile(): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), "eos-diagnostic-state-")), "reservations.sqlite");
}

const reservation = {
  reservation_id: "test-reservation",
  inventory_hostname: "leaf1",
  diagnostic: "ping" as const,
  state: "active" as const,
  reserved_at: "2026-10-27T00:00:00.000Z"
};

describe("durable diagnostic journal", () => {
  it("rejects conflicting reservation and RPC identities rather than recording false correlation", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    try {
      expect(() => journal.save({ ...reservation, rpc_request_id: "another-attempt" })).toThrow(expect.objectContaining({ code: "diagnostic_state_write_failed" }));
      expect(journal.load()).toEqual([]);
    } finally { journal.close(); }
  });

  it("excludes another owner while allowing non-mutating inspection", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    try {
      journal.save(reservation);
      expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_in_use" }));
      expect(inspectDiagnosticJournal(file).reservations).toEqual([reservation]);
      expect(journal.load()).toEqual([reservation]);
    } finally { journal.close(); }
  });

  it("does not mix inventories or silently replace malformed state", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.close();
    expect(() => openDiagnosticJournal(file, "different-inventory")).toThrow(expect.objectContaining({ code: "diagnostic_state_inventory_mismatch" }));
    const restored = openDiagnosticJournal(file, "inventory-identity");
    expect(restored.load()).toHaveLength(1);
    restored.close();
    await fs.writeFile(file, "not a sqlite database");
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    expect(await fs.readFile(file, "utf8")).toBe("not a sqlite database");
  });

  it("does not recreate a missing ledger or ownership file as fresh capacity", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.close();
    await fs.unlink(file);
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    const other = await stateFile();
    openDiagnosticJournal(other, "inventory-identity").close();
    await fs.unlink(`${other}.lock.sqlite`);
    expect(() => openDiagnosticJournal(other, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    await expect(fs.stat(`${other}.lock.sqlite`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects index corruption that would otherwise hide an unresolved reservation", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.close();
    const db = new DatabaseSync(file);
    const index = db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'sqlite_autoindex_reservations_1'").get();
    const page = db.prepare("PRAGMA page_size").get();
    db.close();
    const data = await fs.readFile(file);
    const offset = (Number(index?.rootpage) - 1) * Number(page?.page_size);
    expect(data.readUInt16BE(offset + 3)).toBe(1);
    // Remove only the index cell count: the table record still exists.
    data.writeUInt16BE(0, offset + 3);
    await fs.writeFile(file, data);
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    expect(() => inspectDiagnosticJournal(file)).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
  });

  it("does not repair a missing reservation table into fresh capacity", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.close();
    const corrupt = new DatabaseSync(file);
    corrupt.exec("DROP TABLE reservations");
    corrupt.close();
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
  });

  it("commits removals and never reintroduces confirmed completions", async () => {
    const file = await stateFile();
    const journal = openDiagnosticJournal(file, "inventory-identity");
    journal.save(reservation);
    journal.remove(reservation.reservation_id);
    journal.close();
    const after = openDiagnosticJournal(file, "inventory-identity");
    try { expect(after.load()).toEqual([]); } finally { after.close(); }
  });

  it.skipIf(process.platform === "win32")("rejects public permissions and hard-link aliases", async () => {
    const file = await stateFile();
    openDiagnosticJournal(file, "inventory-identity").close();
    await fs.chmod(file, 0o644);
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_permissions_invalid" }));
    await fs.chmod(file, 0o600);
    const alias = `${file}.alias`;
    await fs.link(file, alias);
    expect(() => openDiagnosticJournal(alias, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_permissions_invalid" }));
  });

  it("never initializes a pre-existing empty or truncated ledger as fresh capacity", async () => {
    const file = await stateFile();
    await fs.writeFile(file, "", { mode: 0o600 });
    expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
  });

  it("recovers committed records and OS ownership after an actual server-process crash", async () => {
    const file = await stateFile();
    const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/diagnostic-journal-child.mjs", file], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        timeout = setTimeout(() => reject(new Error("Journal child did not become ready")), 5000);
        child.stdout?.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes("READY")) resolve();
        });
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`Journal child exited before readiness: ${stderr}`)));
      });
      clearTimeout(timeout);
      expect(() => openDiagnosticJournal(file, "inventory-identity")).toThrow(expect.objectContaining({ code: "diagnostic_state_in_use" }));
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const recovered = openDiagnosticJournal(file, "inventory-identity");
      try {
        expect(recovered.load()).toEqual([expect.objectContaining({ reservation_id: "crash-reservation", state: "uncertain", reason_code: "diagnostic_server_restarted" })]);
      } finally { recovered.close(); }
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
  }, 10_000);

  it("restores unfinished write-ahead reservations as uncertain after reopening", async () => {
    const file = await stateFile();
    const before = openDiagnosticJournal(file, "inventory-identity");
    before.save(reservation);
    before.close();
    const after = openDiagnosticJournal(file, "inventory-identity");
    try {
      expect(after.load()).toEqual([expect.objectContaining({
        ...reservation, state: "uncertain", reason_code: "diagnostic_server_restarted", uncertain_since: expect.any(String)
      })]);
      expect(after.load()[0]).not.toHaveProperty("rpc_request_id");
    } finally {
      after.close();
    }
  });
});
