import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { DiagnosticCapacitySnapshot, DiagnosticRequest, DiagnosticReservationInfo } from "./types.js";
import type { DiagnosticJournal } from "./journalTypes.js";

interface Waiter {
  grant: () => void;
  reject: (error: AppError) => void;
}

interface DiagnosticReservationIntent {
  inventoryHostname: string;
  diagnostic: DiagnosticRequest["kind"];
}

export interface DiagnosticReservation {
  readonly requestId: string;
  complete(): void;
  markUncertain(reasonCode: string): void;
}

/** One instance per server; uncertain remote execution never expires into free capacity. */
export class DiagnosticConcurrency {
  private readonly reservations = new Set<DiagnosticReservationInfo>();
  private readonly waiting: Waiter[] = [];

  private storageError: AppError | undefined;
  private closed = false;

  constructor(private readonly limit: number, private readonly journal?: DiagnosticJournal) {
    for (const reservation of journal?.load() ?? []) {
      this.reservations.add({ ...reservation });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectWaiters(new AppError("diagnostic_state_closed", "Diagnostic execution is shutting down"));
    this.journal?.close();
  }

  snapshot(): DiagnosticCapacitySnapshot {
    const reservations = [...this.reservations].map((reservation) => ({ ...reservation }));
    const uncertain = reservations.filter((reservation) => reservation.state === "uncertain").length;
    return {
      scope: this.journal === undefined ? "server-instance" : "state-file",
      ...(this.storageError === undefined ? {} : { storage_error_code: this.storageError.code }),
      limit: this.limit,
      available_count: this.closed || this.storageError !== undefined ? 0 : Math.max(0, this.limit - reservations.length),
      active_count: reservations.length - uncertain,
      uncertain_count: uncertain,
      queued_count: this.waiting.length,
      reservations
    };
  }

  assertUsableCapacity(): void {
    if (this.closed) throw new AppError("diagnostic_state_closed", "Diagnostic execution is closed");
    if (this.storageError !== undefined) throw this.storageError;
    if (this.isUncertainExhausted()) {
      throw this.capacityError();
    }
  }

  acquire(signal: AbortSignal, intent: DiagnosticReservationIntent): Promise<DiagnosticReservation> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new AppError("operation_aborted", "Diagnostic was cancelled while waiting for capacity"));
        return;
      }
      this.assertUsableCapacity();
      const cancelled = (): void => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        waiter.reject(new AppError("operation_aborted", "Diagnostic was cancelled while waiting for capacity"));
      };
      const waiter: Waiter = {
        reject: (error) => {
          signal.removeEventListener("abort", cancelled);
          reject(error);
        },
        grant: () => {
          signal.removeEventListener("abort", cancelled);
          try {
            resolve(this.reserve(intent));
          } catch (error) {
            reject(error);
          }
        }
      };
      if (this.reservations.size < this.limit) {
        waiter.grant();
      } else {
        this.waiting.push(waiter);
        signal.addEventListener("abort", cancelled, { once: true });
      }
    });
  }

  private reserve(intent: DiagnosticReservationIntent): DiagnosticReservation {
    const requestId = randomUUID();
    const state: DiagnosticReservationInfo = {
      reservation_id: requestId,
      rpc_request_id: requestId,
      inventory_hostname: intent.inventoryHostname,
      diagnostic: intent.diagnostic,
      state: "active",
      reserved_at: new Date().toISOString()
    };
    try {
      this.journal?.save(state);
    } catch {
      throw this.failStorage();
    }
    this.reservations.add(state);
    return {
      requestId,
      complete: () => this.complete(state),
      markUncertain: (reasonCode) => this.markUncertain(state, reasonCode)
    };
  }

  private complete(state: DiagnosticReservationInfo): void {
    if (!this.reservations.has(state)) return;
    try {
      this.journal?.remove(state.reservation_id);
    } catch {
      state.state = "uncertain";
      state.uncertain_since = new Date().toISOString();
      state.reason_code = "diagnostic_state_write_failed";
      throw this.failStorage();
    }
    this.reservations.delete(state);
    this.waiting.shift()?.grant();
  }

  private markUncertain(state: DiagnosticReservationInfo, reasonCode: string): void {
    if (!this.reservations.has(state) || state.state === "uncertain") return;
    state.state = "uncertain";
    state.uncertain_since = new Date().toISOString();
    state.reason_code = reasonCode;
    try {
      this.journal?.save(state);
    } catch {
      // Abort listeners must not throw. The committed active record
      // still prevents fresh capacity on restart; stop all new work.
      this.failStorage();
    }
    if (this.isUncertainExhausted()) this.rejectWaiters(this.capacityError());
  }

  private isUncertainExhausted(): boolean {
    return this.reservations.size >= this.limit && [...this.reservations].every((reservation) => reservation.state === "uncertain");
  }

  private failStorage(): AppError {
    const error = new AppError("diagnostic_state_write_failed", "Diagnostic state could not be committed; all new diagnostics are blocked until operator investigation");
    this.storageError = error;
    this.rejectWaiters(error);
    return error;
  }

  private rejectWaiters(error: AppError): void {
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  private capacityError(): AppError {
    return new AppError(
      "diagnostic_capacity_uncertain",
      "Diagnostic capacity is reserved for executions with unknown remote completion. Inspect eos_get_server_info.diagnostics.capacity and contact an operator; reservations do not expire. Do not retry or restart merely to clear them."
    );
  }
}
