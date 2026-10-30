import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type { DiagnosticCapacitySnapshot, DiagnosticDeviceCapacity, DiagnosticRequest, DiagnosticReservationInfo } from "../diagnostics/types.js";

interface Waiter {
  inventoryHostname: string;
  isDiagnostic: boolean;
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

export interface EapiSlotLimits {
  /** Slots one inventory host may hold across reads and diagnostics. */
  deviceLimit: number;
  /** Of those, the slots diagnostics may hold on one host, so the rest stay free for reads. */
  diagnosticDeviceLimit: number;
  /** Diagnostic slots shared by every device in the server process. Reads have no server-wide limit. */
  diagnosticServerLimit: number;
}

/** One instance per server process, shared by every eAPI request (ADR 0009). A slot is granted only
 * while its device has room and, for a diagnostic, its device's diagnostic share and the server-wide
 * diagnostic ceiling have room; waiters are served oldest first, skipping those that cannot run yet
 * (ADR 0007). A read frees its slot when its request settles. A diagnostic slot with unknown remote
 * completion stays held for the execution budget, then frees itself; a late confirmed response frees
 * it sooner (ADR 0006).
 */
export class EapiSlots {
  /** Held diagnostic slots; an uncertain slot carries the timer that frees it. */
  private readonly reservations = new Map<DiagnosticReservationInfo, NodeJS.Timeout | undefined>();
  private readonly readsHeldByDevice = new Map<string, number>();
  private readonly waiting: Waiter[] = [];
  private closed = false;

  constructor(private readonly limits: EapiSlotLimits, private readonly uncertainHoldMs: number) {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.reservations.values()) clearTimeout(timer);
    const error = closedError();
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  /** Top-level counts cover diagnostics; `devices` also shows each host's read slots. */
  snapshot(): DiagnosticCapacitySnapshot {
    const reservations = Array.from(this.reservations.keys(), (reservation) => ({ ...reservation }));
    const uncertain = reservations.filter((reservation) => reservation.state === "uncertain").length;
    const serverAvailable = this.closed ? 0 : Math.max(0, this.limits.diagnosticServerLimit - reservations.length);
    const queuedDiagnostics = this.waiting.filter((waiter) => waiter.isDiagnostic).length;
    return {
      limit: this.limits.diagnosticServerLimit,
      device_limit: this.limits.diagnosticDeviceLimit,
      eapi_device_limit: this.limits.deviceLimit,
      available_count: serverAvailable,
      active_count: reservations.length - uncertain,
      uncertain_count: uncertain,
      queued_count: queuedDiagnostics,
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
        entry = {
          inventory_hostname: inventoryHostname,
          available_count: 0, active_count: 0, uncertain_count: 0, queued_count: 0,
          read_active_count: 0, read_queued_count: 0
        };
        devices.set(inventoryHostname, entry);
      }
      return entry;
    };
    for (const reservation of reservations) {
      const entry = deviceEntry(reservation.inventory_hostname);
      if (reservation.state === "uncertain") entry.uncertain_count += 1;
      else entry.active_count += 1;
    }
    for (const [inventoryHostname, readsHeld] of this.readsHeldByDevice) deviceEntry(inventoryHostname).read_active_count = readsHeld;
    for (const waiter of this.waiting) {
      const entry = deviceEntry(waiter.inventoryHostname);
      if (waiter.isDiagnostic) entry.queued_count += 1;
      else entry.read_queued_count += 1;
    }
    for (const entry of devices.values()) {
      const diagnosticsHeld = entry.active_count + entry.uncertain_count;
      const diagnosticHeadroom = this.limits.diagnosticDeviceLimit - diagnosticsHeld;
      const deviceHeadroom = this.limits.deviceLimit - diagnosticsHeld - entry.read_active_count;
      entry.available_count = Math.max(0, Math.min(diagnosticHeadroom, deviceHeadroom, serverAvailable));
    }
    return Array.from(devices.values()).sort((left, right) => left.inventory_hostname.localeCompare(right.inventory_hostname));
  }

  /** Waits for a read slot on the host; the returned function frees it. */
  acquireRead(signal: AbortSignal, inventoryHostname: string): Promise<() => void> {
    return this.enqueue(signal, inventoryHostname, false, () => this.reserveRead(inventoryHostname));
  }

  acquireDiagnostic(signal: AbortSignal, intent: DiagnosticReservationIntent): Promise<DiagnosticReservation> {
    return this.enqueue(signal, intent.inventoryHostname, true, () => this.reserveDiagnostic(intent));
  }

  private enqueue<TSlot>(signal: AbortSignal, inventoryHostname: string, isDiagnostic: boolean, reserve: () => TSlot): Promise<TSlot> {
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
        inventoryHostname,
        isDiagnostic,
        reject: (error) => {
          signal.removeEventListener("abort", cancelled);
          reject(error);
        },
        grant: () => {
          signal.removeEventListener("abort", cancelled);
          resolve(reserve());
        }
      };
      if (this.hasRoom(waiter)) {
        waiter.grant();
      } else {
        this.waiting.push(waiter);
        signal.addEventListener("abort", cancelled, { once: true });
      }
    });
  }

  private hasRoom(waiter: Waiter): boolean {
    const diagnosticsHeld = this.diagnosticSlotsHeldBy(waiter.inventoryHostname);
    const readsHeld = this.readsHeldByDevice.get(waiter.inventoryHostname) ?? 0;
    if (diagnosticsHeld + readsHeld >= this.limits.deviceLimit) return false;
    if (!waiter.isDiagnostic) return true;
    return diagnosticsHeld < this.limits.diagnosticDeviceLimit && this.reservations.size < this.limits.diagnosticServerLimit;
  }

  /** Counted from the held reservations, which never exceed the server-wide diagnostic limit. */
  private diagnosticSlotsHeldBy(inventoryHostname: string): number {
    let held = 0;
    for (const reservation of this.reservations.keys()) {
      if (reservation.inventory_hostname === inventoryHostname) held += 1;
    }
    return held;
  }

  private reserveRead(inventoryHostname: string): () => void {
    this.readsHeldByDevice.set(inventoryHostname, (this.readsHeldByDevice.get(inventoryHostname) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const stillHeld = (this.readsHeldByDevice.get(inventoryHostname) ?? 1) - 1;
      if (stillHeld > 0) this.readsHeldByDevice.set(inventoryHostname, stillHeld);
      else this.readsHeldByDevice.delete(inventoryHostname);
      this.grantWaiting();
    };
  }

  private reserveDiagnostic(intent: DiagnosticReservationIntent): DiagnosticReservation {
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
      complete: () => this.freeDiagnostic(state),
      markUncertain: (reasonCode) => this.markUncertain(state, reasonCode)
    };
  }

  private freeDiagnostic(state: DiagnosticReservationInfo): void {
    if (!this.reservations.has(state)) return;
    clearTimeout(this.reservations.get(state));
    this.reservations.delete(state);
    this.grantWaiting();
  }

  /** Grant the oldest waiters that can run now; a waiter that cannot run yet keeps its place. */
  private grantWaiting(): void {
    let index = 0;
    while (index < this.waiting.length) {
      const waiter = this.waiting[index];
      if (waiter !== undefined && this.hasRoom(waiter)) {
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
    this.reservations.set(state, setTimeout(() => this.freeDiagnostic(state), this.uncertainHoldMs).unref());
  }
}

/** Limits from config: top-level `deviceConcurrency` per device, `diagnostics.*` for the diagnostic share. */
export function eapiSlotLimits(config: {
  deviceConcurrency: number;
  diagnostics: { deviceConcurrency: number; maxConcurrentDiagnostics: number };
}): EapiSlotLimits {
  return {
    deviceLimit: config.deviceConcurrency,
    diagnosticDeviceLimit: config.diagnostics.deviceConcurrency,
    diagnosticServerLimit: config.diagnostics.maxConcurrentDiagnostics
  };
}

function closedError(): AppError {
  return new AppError("diagnostic_server_stopping", "eAPI execution is shutting down");
}

function abortedError(): AppError {
  return new AppError("operation_aborted", "Request was cancelled while waiting for device capacity");
}
