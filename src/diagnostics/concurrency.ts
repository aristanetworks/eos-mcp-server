import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { DiagnosticCapacitySnapshot, DiagnosticDeviceCapacity, DiagnosticRequest, DiagnosticReservationInfo } from "./types.js";

interface Waiter {
  inventoryHostname: string;
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

export interface DiagnosticConcurrencyLimits {
  /** Slots shared by every device in the server process. */
  serverLimit: number;
  /** Slots any one inventory host may hold. */
  deviceLimit: number;
}

/** One instance per server process. A slot is granted only while both its device and the process
 * have room; waiters are served oldest first, skipping those whose device is still full (ADR 0007).
 * A slot with unknown remote completion stays held for the execution budget, then frees itself;
 * a late confirmed response frees it sooner (ADR 0006).
 */
export class DiagnosticConcurrency {
  /** Held slots; an uncertain slot carries the timer that frees it. */
  private readonly reservations = new Map<DiagnosticReservationInfo, NodeJS.Timeout | undefined>();
  private readonly waiting: Waiter[] = [];
  private closed = false;

  constructor(private readonly limits: DiagnosticConcurrencyLimits, private readonly uncertainHoldMs: number) {}

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
    const serverAvailable = this.closed ? 0 : Math.max(0, this.limits.serverLimit - reservations.length);
    return {
      limit: this.limits.serverLimit,
      device_limit: this.limits.deviceLimit,
      available_count: serverAvailable,
      active_count: reservations.length - uncertain,
      uncertain_count: uncertain,
      queued_count: this.waiting.length,
      devices: this.deviceBreakdown(reservations, serverAvailable),
      reservations
    };
  }

  /** Per-host counts for every host holding or awaiting a slot, sorted by hostname. */
  private deviceBreakdown(reservations: DiagnosticReservationInfo[], serverAvailable: number): DiagnosticDeviceCapacity[] {
    const devices = new Map<string, DiagnosticDeviceCapacity>();
    const deviceEntry = (inventoryHostname: string): DiagnosticDeviceCapacity => {
      let entry = devices.get(inventoryHostname);
      if (entry === undefined) {
        entry = { inventory_hostname: inventoryHostname, available_count: 0, active_count: 0, uncertain_count: 0, queued_count: 0 };
        devices.set(inventoryHostname, entry);
      }
      return entry;
    };
    for (const reservation of reservations) {
      const entry = deviceEntry(reservation.inventory_hostname);
      if (reservation.state === "uncertain") entry.uncertain_count += 1;
      else entry.active_count += 1;
    }
    for (const waiter of this.waiting) deviceEntry(waiter.inventoryHostname).queued_count += 1;
    for (const entry of devices.values()) {
      const deviceAvailable = this.limits.deviceLimit - entry.active_count - entry.uncertain_count;
      entry.available_count = Math.max(0, Math.min(deviceAvailable, serverAvailable));
    }
    return Array.from(devices.values()).sort((left, right) => left.inventory_hostname.localeCompare(right.inventory_hostname));
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
        inventoryHostname: intent.inventoryHostname,
        reject: (error) => {
          signal.removeEventListener("abort", cancelled);
          reject(error);
        },
        grant: () => {
          signal.removeEventListener("abort", cancelled);
          resolve(this.reserve(intent));
        }
      };
      if (this.hasRoom(intent.inventoryHostname)) {
        waiter.grant();
      } else {
        this.waiting.push(waiter);
        signal.addEventListener("abort", cancelled, { once: true });
      }
    });
  }

  private hasRoom(inventoryHostname: string): boolean {
    return this.reservations.size < this.limits.serverLimit
      && this.slotsHeldBy(inventoryHostname) < this.limits.deviceLimit;
  }

  /** Counted from the held reservations, which never exceed the server limit. */
  private slotsHeldBy(inventoryHostname: string): number {
    let held = 0;
    for (const reservation of this.reservations.keys()) {
      if (reservation.inventory_hostname === inventoryHostname) held += 1;
    }
    return held;
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
    this.grantWaiting();
  }

  /** Grant the oldest waiters that can run now; a waiter on a full device keeps its place.
   * The loop guard only stops the scan early once the server is full; hasRoom decides each grant.
   */
  private grantWaiting(): void {
    let index = 0;
    while (index < this.waiting.length && this.reservations.size < this.limits.serverLimit) {
      const waiter = this.waiting[index];
      if (waiter !== undefined && this.hasRoom(waiter.inventoryHostname)) {
        this.waiting.splice(index, 1);
        waiter.grant();
      } else {
        index += 1;
      }
    }
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
