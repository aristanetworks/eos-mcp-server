import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../core/errors.js";
import { reservationSchema } from "./reservationSchema.js";
import type { DiagnosticReservationInfo } from "./types.js";

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const text = z.string().min(1).max(2000).refine((value) => value.trim().length > 0);
const identity = z.string().regex(/^[a-f0-9]{64}$/);
const coveredReservationSchema = z.object({
  reservation_id: identifier,
  rpc_request_id: identifier.nullable(),
  inventory_hostname: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  reserved_at: z.string().datetime(),
  physical_device_identity: text,
  execution_epoch: text,
  fenced_at: z.string().datetime(),
  evidence_reference: text
}).strict().refine((value) => value.rpc_request_id === null || value.rpc_request_id === value.reservation_id,
  { message: "Wire request identity must match the selected reservation" });

export const fencingAttestationSchema = z.object({
  evidence_version: z.literal(1),
  attestation_id: z.string().uuid(),
  inventory_identity: identity,
  verified_by: text,
  verified_at: z.string().datetime(),
  reason: text,
  assertions: z.object({
    independent_evidence_verified: z.literal(true),
    running_work_terminated: z.literal(true),
    accepted_queued_work_cannot_execute: z.literal(true),
    replay_prevented: z.literal(true)
  }).strict(),
  reservations: z.array(coveredReservationSchema).min(1).max(100)
}).strict().refine((value) => new Set(value.reservations.map((record) => record.reservation_id)).size === value.reservations.length,
  { message: "Attestation contains duplicate reservations" });

export type FencingAttestation = z.infer<typeof fencingAttestationSchema>;

const releaseAuditBodySchema = z.object({
  release_id: z.string().uuid(),
  recorded_at: z.string().datetime(),
  authority: z.literal("operator_attestation"),
  inventory_identity: identity,
  os_user: z.object({ username: z.string().min(1), uid: z.number().int().nullable() }).strict(),
  evidence_sha256: identity,
  evidence: fencingAttestationSchema,
  released_reservations: z.array(reservationSchema).min(1).max(100)
}).strict();
export const releaseAuditSchema = releaseAuditBodySchema.extend({ audit_sha256: identity }).strict();
export type DiagnosticReleaseAudit = z.infer<typeof releaseAuditSchema>;

export interface DiagnosticReleaseRequest {
  reservationIds: string[];
  evidence: unknown;
  confirmedFenced: boolean;
  expectedInventoryIdentity?: string;
}

export interface DiagnosticReleaseResult {
  release_id: string;
  attestation_id: string;
  released_reservation_ids: string[];
  already_committed: boolean;
}

export function parseFencingAttestation(value: unknown): FencingAttestation {
  const parsed = fencingAttestationSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("diagnostic_release_evidence_invalid", "A complete fencing attestation with exact reservation scope and all required assertions is required");
  }
  return parsed.data;
}

export function evidenceDigest(evidence: FencingAttestation): string {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

export function validateReleaseRequest(request: DiagnosticReleaseRequest): FencingAttestation {
  if (request.confirmedFenced !== true) {
    throw new AppError("diagnostic_release_confirmation_required", "Explicit --confirm-fenced is required; silence and elapsed time are not completion evidence");
  }
  const selected = z.array(identifier).min(1).max(100).safeParse(request.reservationIds);
  if (!selected.success || new Set(request.reservationIds).size !== request.reservationIds.length) {
    throw new AppError("diagnostic_release_scope_invalid", "Select explicit, unique reservation IDs; there is no wildcard or release-all operation");
  }
  const evidence = parseFencingAttestation(request.evidence);
  const covered = new Set(evidence.reservations.map((record) => record.reservation_id));
  if (covered.size !== request.reservationIds.length || request.reservationIds.some((id) => !covered.has(id))) {
    throw new AppError("diagnostic_release_scope_mismatch", "Selected reservation IDs must exactly match the attestation scope");
  }
  if (request.expectedInventoryIdentity !== undefined && request.expectedInventoryIdentity !== evidence.inventory_identity) {
    throw new AppError("diagnostic_state_inventory_mismatch", "Configured inventory does not match the attested ledger identity");
  }
  return evidence;
}

/** Consistency checks cannot establish the truth of an operator's external evidence. */
export function matchAttestedReservations(evidence: FencingAttestation, current: DiagnosticReservationInfo[], now: number): DiagnosticReservationInfo[] {
  const verified = Date.parse(evidence.verified_at);
  if (verified > now) throw new AppError("diagnostic_release_evidence_invalid", "Verification time must not be in the future");
  return evidence.reservations.map((covered) => {
    const reservation = current.find((record) => record.reservation_id === covered.reservation_id);
    if (reservation === undefined) {
      throw new AppError("diagnostic_release_reservation_missing", "A selected reservation no longer exists; inspect the audit before retrying");
    }
    if (covered.inventory_hostname !== reservation.inventory_hostname || covered.reserved_at !== reservation.reserved_at ||
        covered.rpc_request_id !== (reservation.rpc_request_id ?? null)) {
      throw new AppError("diagnostic_release_evidence_mismatch", "Attestation does not match the selected immutable execution identity");
    }
    const fenced = Date.parse(covered.fenced_at);
    if (fenced < Date.parse(reservation.reserved_at) || fenced > verified) {
      throw new AppError("diagnostic_release_evidence_invalid", "Fencing must follow reservation admission and precede verification");
    }
    return reservation;
  });
}

export function createReleaseAudit(value: unknown): DiagnosticReleaseAudit {
  const body = releaseAuditBodySchema.parse(value);
  return parseReleaseAudit({ ...body, audit_sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex") });
}

export function parseReleaseAudit(value: unknown): DiagnosticReleaseAudit {
  const audit = releaseAuditSchema.parse(value);
  const { audit_sha256: digest, ...body } = audit;
  if (createHash("sha256").update(JSON.stringify(body)).digest("hex") !== digest) {
    throw new AppError("diagnostic_state_invalid", "Operator release audit checksum is invalid");
  }
  if (audit.inventory_identity !== audit.evidence.inventory_identity || audit.evidence_sha256 !== evidenceDigest(audit.evidence)) {
    throw new AppError("diagnostic_state_invalid", "Operator release audit evidence or inventory binding is invalid");
  }
  matchAttestedReservations(audit.evidence, audit.released_reservations.map((record) => ({
    reservation_id: record.reservation_id, inventory_hostname: record.inventory_hostname, diagnostic: record.diagnostic,
    state: record.state, reserved_at: record.reserved_at,
    ...(record.rpc_request_id === undefined ? {} : { rpc_request_id: record.rpc_request_id })
  })), Date.parse(audit.recorded_at));
  if (audit.released_reservations.length !== audit.evidence.reservations.length) {
    throw new AppError("diagnostic_state_invalid", "Operator release audit has inconsistent reservation scope");
  }
  return audit;
}
