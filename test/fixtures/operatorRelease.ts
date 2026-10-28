import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDiagnosticJournal } from "../../src/diagnostics/journal.js";

export const releaseInventoryIdentity = "a".repeat(64);

export async function operatorReleaseFixture(legacy = false) {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "eos-operator-release-")), "state.sqlite");
  const id = randomUUID();
  const otherId = randomUUID();
  const reservation = {
    reservation_id: id, ...(legacy ? {} : { rpc_request_id: id }), inventory_hostname: "leaf1", diagnostic: "ping" as const,
    state: "uncertain" as const, reserved_at: new Date(Date.now() - 60_000).toISOString(),
    uncertain_since: new Date(Date.now() - 50_000).toISOString(), reason_code: "eapi_request_timeout"
  };
  const journal = openDiagnosticJournal(file, releaseInventoryIdentity);
  journal.save(reservation);
  journal.save({ ...reservation, reservation_id: otherId, rpc_request_id: otherId, inventory_hostname: "leaf2" });
  journal.close();
  const evidence = {
    evidence_version: 1, attestation_id: randomUUID(), inventory_identity: releaseInventoryIdentity,
    verified_by: "network-oncall", verified_at: new Date(Date.now() - 10_000).toISOString(),
    reason: "Approved incident recovery after independent execution-epoch fencing",
    assertions: { independent_evidence_verified: true, running_work_terminated: true, accepted_queued_work_cannot_execute: true, replay_prevented: true },
    reservations: [{
      reservation_id: id, rpc_request_id: legacy ? null : id, inventory_hostname: "leaf1", reserved_at: reservation.reserved_at,
      physical_device_identity: "test-device-serial-1", execution_epoch: "fenced execution epoch 1",
      fenced_at: new Date(Date.now() - 30_000).toISOString(), evidence_reference: "incident:TEST-123/independent-fencing-record"
    }]
  };
  return { file, id, otherId, reservation, evidence };
}
