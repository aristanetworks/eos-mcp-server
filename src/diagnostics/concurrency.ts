import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { DiagnosticCapacitySnapshot, DiagnosticRequest, DiagnosticReservationInfo } from "./types.js";

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

/** One instance per server process. A slot with unknown remote completion stays held for the
 * execution budget, then frees itself; a late confirmed response frees it sooner (ADR 0006).
 */
export class DiagnosticConcurrency {
  /** Held slots; an uncertain slot carries the timer that frees it. */
  private readonly reservations = new Map<DiagnosticReservationInfo, NodeJS.Timeout | undefined>();
  private readonly waiting: Waiter[] = [];
  private closed = false;

  constructor(private readonly limit: number, private readonly uncertainHoldMs: number) {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.reservations.values()) clearTimeout(timer);
    const error = closedError();
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  snapshot(): DiagnosticCapacitySnapshot {
    const reservations = Array.from(this.reservations.keys(), (reservation) => ({ ...reservation }));
    const uncertain = reservations.filter((reservation) => reservation.state === "uncertain").length;
    return {
      limit: this.limit,
      available_count: this.closed ? 0 : Math.max(0, this.limit - reservations.length),
      active_count: reservations.length - uncertain,
      uncertain_count: uncertain,
      queued_count: this.waiting.length,
      reservations
    };
  }

  acquire(signal: AbortSignal, intent: DiagnosticReservationIntent): Promise<DiagnosticReservation> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortedError());
        return;
      }
      if (this.closed) {
        reject(closedError());
        return;
      }
      const cancelled = (): void => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        waiter.reject(abortedError());
      };
      const waiter: Waiter = {
        reject: (error) => {
          signal.removeEventListener("abort", cancelled);
          reject(error);
        },
        grant: () => {
          signal.removeEventListener("abort", cancelled);
          resolve(this.reserve(intent));
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
      inventory_hostname: intent.inventoryHostname,
      diagnostic: intent.diagnostic,
      state: "active",
      reserved_at: new Date().toISOString()
    };
    this.reservations.set(state, undefined);
    return {
      requestId,
      complete: () => this.free(state),
      markUncertain: (reasonCode) => this.markUncertain(state, reasonCode)
    };
  }

  private free(state: DiagnosticReservationInfo): void {
    if (!this.reservations.has(state)) return;
    clearTimeout(this.reservations.get(state));
    this.reservations.delete(state);
    this.waiting.shift()?.grant();
  }

  private markUncertain(state: DiagnosticReservationInfo, reasonCode: string): void {
    if (this.closed || !this.reservations.has(state) || state.state === "uncertain") return;
    const now = Date.now();
    state.state = "uncertain";
    state.uncertain_since = new Date(now).toISOString();
    state.releases_at = new Date(now + this.uncertainHoldMs).toISOString();
    state.reason_code = reasonCode;
    // Unref so a held slot never keeps a stopping server alive.
    this.reservations.set(state, setTimeout(() => this.free(state), this.uncertainHoldMs).unref());
  }
}

function closedError(): AppError {
  return new AppError("diagnostic_server_stopping", "Diagnostic execution is shutting down");
}

function abortedError(): AppError {
  return new AppError("operation_aborted", "Diagnostic was cancelled while waiting for capacity");
}
