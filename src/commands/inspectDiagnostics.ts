import path from "node:path";
import type { ResolvedServerConfig } from "../config/schema.js";
import { toErrorCode, toErrorMessage } from "../core/errors.js";
import { resolveDiagnosticStateFile } from "../diagnostics/statePath.js";
import { prettyJson } from "../utils/json.js";

/** Offline/read-only: no credentials, device calls, ownership takeover, or capacity reset. */
export async function runInspectDiagnostics(config: ResolvedServerConfig, asJson: boolean): Promise<number> {
  try {
    const file = resolveDiagnosticStateFile(config);
    const { inspectDiagnosticJournal } = await import("../diagnostics/journal.js");
    const state = inspectDiagnosticJournal(file);
    const output = { state_file: path.basename(file), schema_version: state.schema_version, inventory_identity: state.inventory_identity,
      unresolved_count: state.reservations.length, reservations: state.reservations, release_audit: state.release_audit };
    if (asJson) {
      console.log(prettyJson(output));
    } else {
      console.log(`Diagnostic ledger: ${output.state_file}`);
      console.log(`Inventory identity: ${output.inventory_identity}`);
      console.log(`Unresolved reservations: ${output.unresolved_count}`);
      for (const reservation of output.reservations) {
        console.log(`- ${reservation.reservation_id}: ${reservation.inventory_hostname} recorded ${reservation.state}${reservation.reason_code === undefined ? "" : ` (${reservation.reason_code})`}; RPC ID: ${reservation.rpc_request_id ?? "(not recorded)"}`);
      }
      console.log(`Operator release audit records: ${output.release_audit.length} (use --json for evidence and OS identity)`);
      console.log("Recorded state is not proof of remote completion. No reservation was cleared.");
    }
    return 0;
  } catch (error) {
    if (!asJson) throw error;
    console.log(prettyJson({ error_code: toErrorCode(error, "diagnostic_state_invalid"), message: toErrorMessage(error) }));
    return 1;
  }
}
