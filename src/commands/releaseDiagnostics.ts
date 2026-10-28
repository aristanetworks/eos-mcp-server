import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import type { ResolvedServerConfig } from "../config/schema.js";
import { AppError, toErrorCode, toErrorMessage } from "../core/errors.js";
import { diagnosticInventoryIdentity, resolveDiagnosticStateFile } from "../diagnostics/statePath.js";
import { prettyJson } from "../utils/json.js";
import { isPrivateRegularFile } from "../utils/privateFile.js";

const MAX_EVIDENCE_BYTES = 65_536;

async function readEvidence(file: string): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new AppError("diagnostic_release_evidence_invalid", "Evidence must be a regular file, not a symlink or device");
    }
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = await handle.stat();
    if (!isPrivateRegularFile(stat) || stat.ino !== before.ino || stat.dev !== before.dev) {
      throw new AppError("diagnostic_release_evidence_invalid", "Evidence must be a private owner-controlled file (POSIX mode 0600)");
    }
    const buffer = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_EVIDENCE_BYTES) {
      throw new AppError("diagnostic_release_evidence_too_large", "Evidence JSON must not exceed 65536 bytes; release smaller explicit batches");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    const value: unknown = JSON.parse(text);
    if (parseDocument(text, { uniqueKeys: true, prettyErrors: false }).errors.length > 0) {
      throw new AppError("diagnostic_release_evidence_invalid", "Evidence JSON must not contain duplicate or ambiguous object keys");
    }
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("diagnostic_release_evidence_invalid", "Cannot read a private regular UTF-8 JSON evidence file");
  } finally {
    await handle?.close();
  }
}

export interface ReleaseDiagnosticsOptions {
  reservationIds?: string[];
  evidenceFile?: string;
  confirmFenced?: boolean;
  json?: boolean;
}

/** Offline operator authority: no credentials, device calls, evidence fetching, or MCP reset. */
export async function runReleaseDiagnostics(config: ResolvedServerConfig, options: ReleaseDiagnosticsOptions): Promise<number> {
  try {
    if (options.confirmFenced !== true) {
      throw new AppError("diagnostic_release_confirmation_required", "Explicit --confirm-fenced is required after independent fencing verification");
    }
    if (options.evidenceFile === undefined) {
      throw new AppError("cli_missing_evidence_file", "release-diagnostics requires --evidence-file");
    }
    if (options.reservationIds === undefined || options.reservationIds.length === 0) {
      throw new AppError("cli_missing_reservation", "release-diagnostics requires explicit --reservation-id values");
    }
    const evidence = await readEvidence(path.resolve(options.evidenceFile));
    const file = resolveDiagnosticStateFile(config);
    const expected = config.inventoryPath === undefined ? undefined : diagnosticInventoryIdentity(config.inventoryPath);
    const { releaseDiagnosticReservations } = await import("../diagnostics/journal.js");
    const result = releaseDiagnosticReservations(file, {
      reservationIds: options.reservationIds, evidence, confirmedFenced: true,
      ...(expected === undefined ? {} : { expectedInventoryIdentity: expected })
    });
    if (options.json) {
      console.log(prettyJson({ ...result, authority: "operator_attestation" }));
    } else {
      console.log(`${result.already_committed ? "Already committed" : "Operator release committed"}: ${result.release_id}`);
      for (const id of result.released_reservation_ids) console.log(`- ${id}`);
      console.log("Authority: operator attestation, not machine-confirmed EOS completion. Inspect the durable audit before any further recovery.");
    }
    return 0;
  } catch (error) {
    if (!options.json) throw error;
    console.log(prettyJson({ error_code: toErrorCode(error, "diagnostic_release_failed"), message: toErrorMessage(error) }));
    return 1;
  }
}
