import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { AppError } from "../core/errors.js";
import { isPrivateRegularFile } from "../utils/privateFile.js";
import { isObject } from "../utils/value.js";
import type { DiagnosticJournal } from "./journalTypes.js";
import type { DiagnosticReservationInfo } from "./types.js";

import { parseReservation, reservationSchema } from "./reservationSchema.js";
import {
  createReleaseAudit, evidenceDigest, matchAttestedReservations, parseReleaseAudit, validateReleaseRequest,
  type DiagnosticReleaseAudit, type DiagnosticReleaseRequest, type DiagnosticReleaseResult, type FencingAttestation
} from "./releaseEvidence.js";

function checkPrivateFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (!isPrivateRegularFile(stat)) {
    throw new AppError("diagnostic_state_permissions_invalid", "Diagnostic state must be a private, owner-controlled regular file");
  }
}

function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function ensurePrivateFile(file: string): boolean {
  let created = false;
  try {
    const fd = fs.openSync(file, "wx", 0o600);
    created = true;
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDirectory(path.dirname(file));
  } catch (error) {
    if (!isObject(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  checkPrivateFile(file);
  return created;
}

function checkIntegrity(db: DatabaseSync): void {
  const results = db.prepare("PRAGMA integrity_check").all();
  if (results.length !== 1 || results[0]?.integrity_check !== "ok") {
    throw new AppError("diagnostic_state_invalid", "Diagnostic ledger integrity check failed; capacity must not be recovered from corrupt indexes or records");
  }
}

function readReservations(db: DatabaseSync): DiagnosticReservationInfo[] {
  return db.prepare("SELECT reservation_id, payload FROM reservations ORDER BY reservation_id").all().map((row) => {
    const value: unknown = typeof row.payload === "string" ? JSON.parse(row.payload) : undefined;
    const reservation = parseReservation(value);
    if (reservation.reservation_id !== row.reservation_id) {
      throw new AppError("diagnostic_state_invalid", "Diagnostic reservation identity does not match its stored record");
    }
    return reservation;
  });
}

function readMetadata(db: DatabaseSync): { schema_version: 1 | 2; inventory_identity: string } {
  const metadata = db.prepare("SELECT schema_version, inventory_identity FROM metadata WHERE id = 1").get();
  if ((metadata?.schema_version !== 1 && metadata?.schema_version !== 2) || typeof metadata.inventory_identity !== "string" || metadata.inventory_identity.length === 0) {
    throw new AppError("diagnostic_state_invalid", "Unsupported or invalid diagnostic state schema");
  }
  return { schema_version: metadata.schema_version, inventory_identity: metadata.inventory_identity };
}

function readAudit(db: DatabaseSync, version: 1 | 2, inventoryIdentity: string): DiagnosticReleaseAudit[] {
  if (version === 1) {
    if (db.prepare("SELECT name FROM sqlite_schema WHERE name = 'release_audit'").get() !== undefined) {
      throw new AppError("diagnostic_state_invalid", "Legacy state has unexpected release audit data; it must not be ignored");
    }
    return [];
  }
  return db.prepare("SELECT release_id, attestation_id, payload FROM release_audit ORDER BY rowid").all().map((row) => {
    const audit = parseReleaseAudit(typeof row.payload === "string" ? JSON.parse(row.payload) : undefined);
    if (audit.release_id !== row.release_id || audit.evidence.attestation_id !== row.attestation_id || audit.inventory_identity !== inventoryIdentity) {
      throw new AppError("diagnostic_state_invalid", "Operator audit identity does not match its ledger record");
    }
    return audit;
  });
}

class SqliteDiagnosticJournal implements DiagnosticJournal {
  private closed = false;

  constructor(private readonly db: DatabaseSync, private readonly ownership: DatabaseSync) {}

  load(): DiagnosticReservationInfo[] {
    this.assertOpen();
    try {
      return readReservations(this.db);
    } catch {
      throw new AppError("diagnostic_state_invalid", "Cannot read validated diagnostic reservations; state was not reset");
    }
  }

  save(reservation: DiagnosticReservationInfo): void {
    this.assertOpen();
    try {
      const value = reservationSchema.parse(reservation);
      this.db.prepare("INSERT INTO reservations (reservation_id, payload) VALUES (?, ?) ON CONFLICT(reservation_id) DO UPDATE SET payload = excluded.payload")
        .run(value.reservation_id, JSON.stringify(value));
    } catch {
      throw new AppError("diagnostic_state_write_failed", "Cannot durably save diagnostic reservation; no capacity may be assumed free");
    }
  }

  remove(reservationId: string): void {
    this.assertOpen();
    try {
      const result = this.db.prepare("DELETE FROM reservations WHERE reservation_id = ?").run(reservationId);
      if (Number(result.changes) !== 1) {
        throw new AppError("diagnostic_state_invalid", "Reservation was missing from the durable ledger");
      }
    } catch {
      throw new AppError("diagnostic_state_write_failed", "Cannot durably record diagnostic completion; reservation remains unavailable");
    }
  }

  release(evidence: FencingAttestation): DiagnosticReleaseResult {
    this.assertOpen();
    const metadata = readMetadata(this.db);
    const current = readReservations(this.db);
    const previous = readAudit(this.db, metadata.schema_version, metadata.inventory_identity)
      .find((audit) => audit.evidence.attestation_id === evidence.attestation_id);
    if (previous !== undefined) {
      if (previous.evidence_sha256 !== evidenceDigest(evidence)) {
        throw new AppError("diagnostic_release_attestation_reused", "An attestation ID cannot authorize different evidence or reservation scope");
      }
      if (previous.released_reservations.some((released) => current.some((record) => record.reservation_id === released.reservation_id))) {
        throw new AppError("diagnostic_state_invalid", "An already released reservation has reappeared in unresolved state");
      }
      this.db.exec("COMMIT");
      return { release_id: previous.release_id, attestation_id: evidence.attestation_id,
        released_reservation_ids: previous.released_reservations.map((record) => record.reservation_id), already_committed: true };
    }
    const now = Date.now();
    const selected = matchAttestedReservations(evidence, current, now);
    const user = os.userInfo();
    const audit = createReleaseAudit({
      release_id: randomUUID(), recorded_at: new Date(now).toISOString(), authority: "operator_attestation",
      inventory_identity: metadata.inventory_identity, os_user: { username: user.username, uid: user.uid < 0 ? null : user.uid },
      evidence_sha256: evidenceDigest(evidence), evidence, released_reservations: selected
    });
    this.db.prepare("INSERT INTO release_audit (release_id, attestation_id, payload) VALUES (?, ?, ?)")
      .run(audit.release_id, evidence.attestation_id, JSON.stringify(audit));
    for (const reservation of selected) {
      if (Number(this.db.prepare("DELETE FROM reservations WHERE reservation_id = ?").run(reservation.reservation_id).changes) !== 1) {
        throw new AppError("diagnostic_state_invalid", "Selected reservation changed during operator release");
      }
    }
    this.db.exec("COMMIT");
    return { release_id: audit.release_id, attestation_id: evidence.attestation_id,
      released_reservation_ids: selected.map((record) => record.reservation_id), already_committed: false };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      try { this.db.close(); } finally { this.ownership.close(); }
    } catch {
      throw new AppError("diagnostic_state_close_failed", "Cannot close diagnostic state cleanly; inspect state before restarting");
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AppError("diagnostic_state_closed", "Diagnostic state is closed; commands must not be dispatched");
    }
  }
}

/** Separate SQLite ownership lock: crash-released by the OS, independent of ledger commits. */
function openJournal(stateFile: string, inventoryIdentity: string, mode: "serve" | "release"): SqliteDiagnosticJournal {
  let ownership: DatabaseSync | undefined;
  let db: DatabaseSync | undefined;
  try {
    const directory = path.dirname(path.resolve(stateFile));
    if (mode === "release" && (!fs.existsSync(stateFile) || !fs.existsSync(`${stateFile}.lock.sqlite`))) {
      throw new AppError("diagnostic_state_invalid", "Operator release requires an existing ledger and ownership file; no state is created");
    }
    const createdDirectory = fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (createdDirectory !== undefined) {
      // Persist every newly-created directory link, not only the files in the
      // leaf directory. FULL SQLite commits cannot repair a lost parent link.
      const stop = fs.realpathSync(path.dirname(path.resolve(createdDirectory)));
      let current = fs.realpathSync(directory);
      while (true) {
        syncDirectory(current);
        const parent = path.dirname(current);
        if (current === stop || parent === current) break;
        current = parent;
      }
    }
    const stat = fs.statSync(directory);
    if (process.platform !== "win32" && ((stat.mode & 0o022) !== 0 || (process.getuid !== undefined && stat.uid !== process.getuid()))) {
      throw new AppError("diagnostic_state_permissions_invalid", "Diagnostic state directory must be owner-controlled and not group/world writable");
    }
    const file = path.join(fs.realpathSync(directory), path.basename(stateFile));
    const lockFile = `${file}.lock.sqlite`;
    if (fs.existsSync(file)) checkPrivateFile(file);
    if (fs.existsSync(file) !== fs.existsSync(lockFile)) {
      throw new AppError("diagnostic_state_invalid", "Diagnostic ledger and ownership file must be preserved together; neither may be recreated as fresh capacity");
    }
    const newLock = ensurePrivateFile(lockFile);
    ownership = new DatabaseSync(lockFile, { allowExtension: false, timeout: 0 });
    ownership.exec("BEGIN EXCLUSIVE");
    if (!newLock && !fs.existsSync(file)) {
      throw new AppError("diagnostic_state_invalid", "Existing diagnostic ownership has no ledger; state was not recreated");
    }
    const created = ensurePrivateFile(file);
    if (!created && fs.statSync(file).size === 0) {
      throw new AppError("diagnostic_state_invalid", "Existing diagnostic state is empty or truncated; it must not be initialized as new");
    }
    db = new DatabaseSync(file, { allowExtension: false, timeout: 0 });
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF; BEGIN IMMEDIATE");
    checkIntegrity(db);
    if (created) {
      db.exec(`CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id = 1), schema_version INTEGER NOT NULL, inventory_identity TEXT NOT NULL);
        CREATE TABLE reservations (reservation_id TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
    }
    const metadata = db.prepare("SELECT id FROM metadata").get();
    if (metadata === undefined) {
      if (!created) {
        throw new AppError("diagnostic_state_invalid", "Existing diagnostic state has no metadata; it must not be reset");
      }
      if (db.prepare("SELECT reservation_id FROM reservations LIMIT 1").get() !== undefined) {
        throw new AppError("diagnostic_state_invalid", "Diagnostic state has reservations without metadata");
      }
      db.prepare("INSERT INTO metadata VALUES (1, 1, ?)").run(inventoryIdentity);
    }
    const stored = readMetadata(db);
    if (stored.inventory_identity !== inventoryIdentity) {
      throw new AppError("diagnostic_state_inventory_mismatch", "Diagnostic state belongs to a different inventory; it must not be reset or reused");
    }
    readAudit(db, stored.schema_version, inventoryIdentity);
    if (stored.schema_version === 1) {
      db.exec("CREATE TABLE release_audit (release_id TEXT PRIMARY KEY, attestation_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL); UPDATE metadata SET schema_version = 2 WHERE id = 1");
    }
    for (const reservation of readReservations(db)) {
      if (mode === "serve" && reservation.state === "active") {
        const recovered: DiagnosticReservationInfo = {
          ...reservation, state: "uncertain", uncertain_since: new Date().toISOString(), reason_code: "diagnostic_server_restarted"
        };
        db.prepare("UPDATE reservations SET payload = ? WHERE reservation_id = ?").run(JSON.stringify(recovered), reservation.reservation_id);
      }
    }
    if (mode === "serve") db.exec("COMMIT");
    return new SqliteDiagnosticJournal(db, ownership);
  } catch (error) {
    db?.close();
    ownership?.close();
    if (error instanceof AppError) throw error;
    const busy = isObject(error) && error.errcode === 5;
    throw new AppError(busy ? "diagnostic_state_in_use" : "diagnostic_state_invalid",
      busy ? "Another server owns this diagnostic ledger; do not bypass it with a new state file" : "Cannot open diagnostic state safely; existing state was not reset");
  }
}

export function openDiagnosticJournal(stateFile: string, inventoryIdentity: string): DiagnosticJournal {
  return openJournal(stateFile, inventoryIdentity, "serve");
}

/** No API device calls: release is explicitly authorized operator authority, not observed completion. */
export function releaseDiagnosticReservations(stateFile: string, request: DiagnosticReleaseRequest): DiagnosticReleaseResult {
  const evidence = validateReleaseRequest(request);
  const journal = openJournal(stateFile, evidence.inventory_identity, "release");
  try {
    return journal.release(evidence);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("diagnostic_release_failed", "Operator release could not commit; inspect reservations and audit before retrying");
  } finally {
    journal.close();
  }
}

export interface DiagnosticJournalInspection {
  schema_version: 1 | 2;
  inventory_identity: string;
  reservations: DiagnosticReservationInfo[];
  release_audit: DiagnosticReleaseAudit[];
}

/** Read-only inspection never acquires ownership, clears reservations, or normalizes state. */
export function inspectDiagnosticJournal(stateFile: string): DiagnosticJournalInspection {
  let db: DatabaseSync | undefined;
  try {
    checkPrivateFile(stateFile);
    db = new DatabaseSync(stateFile, { readOnly: true, allowExtension: false, timeout: 1000 });
    // Keep integrity, schema, reservations, and audit in one read-only snapshot.
    db.exec("PRAGMA trusted_schema = OFF; BEGIN");
    checkIntegrity(db);
    const metadata = readMetadata(db);
    const inspection = { ...metadata, reservations: readReservations(db), release_audit: readAudit(db, metadata.schema_version, metadata.inventory_identity) };
    db.exec("COMMIT");
    return inspection;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("diagnostic_state_invalid", "Cannot inspect diagnostic state; no file was created or reset");
  } finally {
    db?.close();
  }
}
