import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { inspectDiagnosticJournal, openDiagnosticJournal, releaseDiagnosticReservations } from "../src/diagnostics/journal.js";

import { operatorReleaseFixture as fixture, releaseInventoryIdentity as inventoryIdentity } from "./fixtures/operatorRelease.js";
import { parseFencingAttestation } from "../src/diagnostics/releaseEvidence.js";

describe("offline audited operator release", () => {
  it("ships a deliberately invalid evidence template that cannot authorize release as-is", async () => {
    const template: unknown = JSON.parse(await fs.readFile("docs/examples/diagnostic-release-evidence.template.json", "utf8"));
    expect(() => parseFencingAttestation(template)).toThrow(expect.objectContaining({ code: "diagnostic_release_evidence_invalid" }));
  });

  it("inspects schema 1 without migration and upgrades it without losing unresolved work", async () => {
    const { file } = await fixture();
    const db = new DatabaseSync(file);
    db.exec("DROP TABLE release_audit; UPDATE metadata SET schema_version = 1");
    db.close();
    expect(inspectDiagnosticJournal(file)).toMatchObject({ schema_version: 1, release_audit: [] });
    const journal = openDiagnosticJournal(file, inventoryIdentity);
    try { expect(journal.load()).toHaveLength(2); } finally { journal.close(); }
    expect(inspectDiagnosticJournal(file)).toMatchObject({ schema_version: 2, release_audit: [] });
  });

  it("rolls back schema migration too when release evidence does not match", async () => {
    const { file, id, evidence } = await fixture();
    const db = new DatabaseSync(file);
    db.exec("DROP TABLE release_audit; UPDATE metadata SET schema_version = 1");
    db.close();
    const first = evidence.reservations[0];
    if (first === undefined) throw new Error("Missing fixture");
    first.inventory_hostname = "wrong-host";
    const before = inspectDiagnosticJournal(file);
    expect(() => releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true })).toThrow();
    expect(inspectDiagnosticJournal(file)).toEqual(before);
  });

  it("rejects missing schema-2 audit history without releasing reservations", async () => {
    const { file, id, evidence } = await fixture();
    const db = new DatabaseSync(file);
    db.exec("DROP TABLE release_audit");
    db.close();
    expect(() => releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true }))
      .toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    expect(() => inspectDiagnosticJournal(file)).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
    const check = new DatabaseSync(file, { readOnly: true });
    try { expect(check.prepare("SELECT count(*) AS total FROM reservations").get()?.total).toBe(2); } finally { check.close(); }
  });

  it("refuses a missing selected execution instead of releasing other reservations", async () => {
    const { file, evidence } = await fixture();
    const missing = randomUUID();
    const first = evidence.reservations[0];
    if (first === undefined) throw new Error("Missing fixture");
    first.reservation_id = missing;
    first.rpc_request_id = missing;
    expect(() => releaseDiagnosticReservations(file, { reservationIds: [missing], evidence, confirmedFenced: true }))
      .toThrow(expect.objectContaining({ code: "diagnostic_release_reservation_missing" }));
    expect(inspectDiagnosticJournal(file).reservations).toHaveLength(2);
  });

  it("refuses release while a server owns the ledger", async () => {
    const { file, id, evidence } = await fixture();
    const owner = openDiagnosticJournal(file, inventoryIdentity);
    try {
      expect(() => releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true }))
        .toThrow(expect.objectContaining({ code: "diagnostic_state_in_use" }));
      expect(owner.load()).toHaveLength(2);
      expect(inspectDiagnosticJournal(file).release_audit).toEqual([]);
    } finally { owner.close(); }
  });

  it.each([
    "confirmation", "missing assertion", "wrong scope", "duplicate selection", "wrong host", "wrong request ID",
    "wrong admission time", "wrong inventory", "future verification", "old fence", "unverified fence", "empty evidence reference"
  ])("refuses %s without changing reservations or audit", async (condition) => {
    const { file, id, otherId, evidence } = await fixture();
    const proof = structuredClone(evidence);
    let ids = [id];
    const covered = proof.reservations[0];
    if (covered === undefined) throw new Error("Missing fixture");
    if (condition === "missing assertion") proof.assertions.replay_prevented = false;
    if (condition === "wrong scope") ids = [otherId];
    if (condition === "duplicate selection") ids = [id, id];
    if (condition === "wrong host") covered.inventory_hostname = "other-host";
    if (condition === "wrong request ID") covered.rpc_request_id = null;
    if (condition === "wrong admission time") covered.reserved_at = new Date(Date.now() - 120_000).toISOString();
    if (condition === "wrong inventory") proof.inventory_identity = "b".repeat(64);
    if (condition === "future verification") proof.verified_at = new Date(Date.now() + 60_000).toISOString();
    if (condition === "old fence") covered.fenced_at = new Date(Date.now() - 120_000).toISOString();
    if (condition === "unverified fence") covered.fenced_at = new Date().toISOString();
    if (condition === "empty evidence reference") covered.evidence_reference = "   ";
    const before = inspectDiagnosticJournal(file);
    expect(() => releaseDiagnosticReservations(file, { reservationIds: ids, evidence: proof, confirmedFenced: condition !== "confirmation" })).toThrow();
    expect(inspectDiagnosticJournal(file)).toEqual(before);
  });

  it("requires the configured inventory to match the attestation", async () => {
    const { file, id, evidence } = await fixture();
    expect(() => releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true, expectedInventoryIdentity: "b".repeat(64) }))
      .toThrow(expect.objectContaining({ code: "diagnostic_state_inventory_mismatch" }));
    expect(inspectDiagnosticJournal(file).reservations).toHaveLength(2);
  });

  it("rolls back both audit and earlier deletions if a later deletion fails", async () => {
    const { file, id, otherId, evidence } = await fixture();
    const first = evidence.reservations[0];
    if (first === undefined) throw new Error("Missing fixture");
    evidence.reservations.push({ ...first, reservation_id: otherId, rpc_request_id: otherId, inventory_hostname: "leaf2", physical_device_identity: "device-2" });
    const db = new DatabaseSync(file);
    db.exec(`CREATE TRIGGER fail_release BEFORE DELETE ON reservations WHEN OLD.reservation_id = '${otherId}' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);
    db.close();
    expect(() => releaseDiagnosticReservations(file, { reservationIds: [id, otherId], evidence, confirmedFenced: true }))
      .toThrow(expect.objectContaining({ code: "diagnostic_release_failed" }));
    const after = inspectDiagnosticJournal(file);
    expect(after.reservations).toHaveLength(2);
    expect(after.release_audit).toEqual([]);
  });

  it("recognizes a committed retry without issuing another release or audit", async () => {
    const { file, id, evidence } = await fixture();
    const request = { reservationIds: [id], evidence, confirmedFenced: true };
    const first = releaseDiagnosticReservations(file, request);
    expect(releaseDiagnosticReservations(file, request)).toEqual({ ...first, already_committed: true });
    expect(inspectDiagnosticJournal(file).release_audit).toHaveLength(1);
    expect(() => releaseDiagnosticReservations(file, { ...request, evidence: { ...evidence, reason: "different evidence" } }))
      .toThrow(expect.objectContaining({ code: "diagnostic_release_attestation_reused" }));
  });

  it("detects accidental changes to audit authority metadata, not just evidence contents", async () => {
    const { file, id, evidence } = await fixture();
    releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true });
    const db = new DatabaseSync(file);
    const row = db.prepare("SELECT release_id, payload FROM release_audit").get();
    const audit = JSON.parse(String(row?.payload));
    audit.os_user.username = "changed-account";
    db.prepare("UPDATE release_audit SET payload = ? WHERE release_id = ?").run(JSON.stringify(audit), String(row?.release_id));
    db.close();
    expect(() => inspectDiagnosticJournal(file)).toThrow(expect.objectContaining({ code: "diagnostic_state_invalid" }));
  });

  it("requires an explicit null wire identity for legacy reservations", async () => {
    const { file, id, evidence } = await fixture(true);
    expect(evidence.reservations[0]?.rpc_request_id).toBeNull();
    releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true });
    expect(inspectDiagnosticJournal(file).release_audit[0]?.released_reservations[0]).not.toHaveProperty("rpc_request_id");
  });

  it("never creates a missing ledger during operator release", async () => {
    const { file, id, evidence } = await fixture();
    const missing = path.join(path.dirname(file), "missing", "state.sqlite");
    expect(() => releaseDiagnosticReservations(missing, { reservationIds: [id], evidence, confirmedFenced: true })).toThrow();
    await expect(fs.stat(path.dirname(missing))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically releases only the selected reservations and retains a durable attestation audit", async () => {
    const { file, id, otherId, evidence } = await fixture();
    const result = releaseDiagnosticReservations(file, { reservationIds: [id], evidence, confirmedFenced: true });
    expect(result).toMatchObject({ already_committed: false, attestation_id: evidence.attestation_id, released_reservation_ids: [id] });
    const state = inspectDiagnosticJournal(file);
    expect(state.schema_version).toBe(2);
    expect(state.reservations.map((record) => record.reservation_id)).toEqual([otherId]);
    expect(state.release_audit).toEqual([expect.objectContaining({
      release_id: result.release_id, authority: "operator_attestation", evidence,
      os_user: expect.objectContaining({ username: expect.any(String) }),
      evidence_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      released_reservations: [expect.objectContaining({ reservation_id: id })]
    })]);
    const reopened = openDiagnosticJournal(file, inventoryIdentity);
    try { expect(reopened.load().map((record) => record.reservation_id)).toEqual([otherId]); }
    finally { reopened.close(); }
    expect(inspectDiagnosticJournal(file).release_audit).toHaveLength(1);
  });
});
