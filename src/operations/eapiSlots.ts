import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";

/** `reservation_id` doubles as the execution's JSON-RPC request ID. `diagnostic` is the kind the
 * caller named; these slots attach no meaning to it beyond counting and an optional per-kind limit.
 */
export interface DiagnosticReservationInfo {
  reservation_id: string;
  inventory_hostname: string;
  diagnostic: string;
  state: "active" | "uncertain";
  reserved_at: string;
  uncertain_since?: string;
  releases_at?: string;
  reason_code?: string;
}

interface DiagnosticSlotCounts {
  available_count: number;
  active_count: number;
  uncertain_count: number;
  queued_count: number;
}

/** One diagnostic kind's share of a host's diagnostic slots. */
export interface DiagnosticKindSlotCounts {
  active_count: number;
  uncertain_count: number;
  queued_count: number;
}

/** Slot usage of one inventory host; only hosts holding or awaiting a slot are listed.
 * The four shared counts are diagnostic slots; `available_count` is the diagnostic headroom,
 * capped by the host's shared eAPI headroom and server-wide availability. `kinds` splits the
 * diagnostic slots by kind, listing only kinds that hold or await one on this host.
 */
export interface DiagnosticDeviceCapacity extends DiagnosticSlotCounts {
  inventory_hostname: string;
  read_active_count: number;
  read_queued_count: number;
  kinds: Record<string, DiagnosticKindSlotCounts>;
}

/** Top-level counts are server-wide diagnostics; `devices` breaks them down per host, with reads. */
export interface DiagnosticCapacitySnapshot extends DiagnosticSlotCounts {
  limit: number;
  device_limit: number;
  /** eAPI slots one host may hold across reads and diagnostics. */
  eapi_device_limit: number;
  devices: DiagnosticDeviceCapacity[];
  reservations: DiagnosticReservationInfo[];
}

/** What a waiter asks for; a diagnostic names its kind, and any per-device limit that kind has. */
type SlotRequest =
  | { inventoryHostname: string; kind: "read" }
  | { inventoryHostname: string; kind: "diagnostic"; diagnostic: string; kindDeviceLimit?: number };

type Waiter = SlotRequest & {
  grant: () => void;
  reject: (error: AppError) => void;
};

export interface DiagnosticReservationIntent {
  inventoryHostname: string;
  diagnostic: string;
  /** How long the slot stays held once the execution's remote completion is unknown. */
  uncertainHoldMs: number;
  /** Of the host's diagnostic slots, at most this many may hold this kind at once; absent means only the shared limits apply. */
  kindDeviceLimit?: number;
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
 * diagnostic ceiling have room, and the kind's own per-device limit too when it names one (ADR 0010);
 * waiters are served oldest first, skipping those that cannot run yet (ADR 0007). A read frees its
 * slot when its request settles. A diagnostic slot with unknown remote completion stays held for its
 * own execution's budget, then frees itself; a late confirmed response frees it sooner (ADR 0006).
 */
export class EapiSlots {
  /** Held diagnostic slots, each with its own uncertain hold; an uncertain slot carries the timer that frees it. */
  private readonly reservations = new Map<DiagnosticReservationInfo, NodeJS.Timeout | undefined>();
  private readonly readsHeldByDevice = new Map<string, number>();
  private readonly waiting: Waiter[] = [];
  private closed = false;

  constructor(private readonly limits: EapiSlotLimits) {}

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
    const queuedDiagnostics = this.waiting.filter((waiter) => waiter.kind === "diagnostic").length;
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
          read_active_count: 0, read_queued_count: 0,
          kinds: {}
        };
        devices.set(inventoryHostname, entry);
      }
      return entry;
    };
    const kindEntry = (device: DiagnosticDeviceCapacity, diagnostic: string): DiagnosticKindSlotCounts => {
      const existingCounts = device.kinds[diagnostic];
      if (existingCounts !== undefined) return existingCounts;
      const newCounts = { active_count: 0, uncertain_count: 0, queued_count: 0 };
      device.kinds[diagnostic] = newCounts;
      return newCounts;
    };
    for (const reservation of reservations) {
      const entry = deviceEntry(reservation.inventory_hostname);
      const kindCounts = kindEntry(entry, reservation.diagnostic);
      if (reservation.state === "uncertain") {
        entry.uncertain_count += 1;
        kindCounts.uncertain_count += 1;
      } else {
        entry.active_count += 1;
        kindCounts.active_count += 1;
      }
    }
    for (const [inventoryHostname, readsHeld] of this.readsHeldByDevice) deviceEntry(inventoryHostname).read_active_count = readsHeld;
    for (const waiter of this.waiting) {
      const entry = deviceEntry(waiter.inventoryHostname);
      if (waiter.kind === "read") {
        entry.read_queued_count += 1;
      } else {
        entry.queued_count += 1;
        kindEntry(entry, waiter.diagnostic).queued_count += 1;
      }
    }
    for (const entry of devices.values()) {
      entry.available_count = this.diagnosticHeadroom(entry.active_count + entry.uncertain_count, entry.read_active_count, serverAvailable);
    }
    return Array.from(devices.values()).sort((left, right) => left.inventory_hostname.localeCompare(right.inventory_hostname));
  }

  /** Waits for a read slot on the host; the returned function frees it. */
  acquireRead(signal: AbortSignal | undefined, inventoryHostname: string): Promise<() => void> {
    return this.enqueue(signal, { inventoryHostname, kind: "read" }, () => this.reserveRead(inventoryHostname));
  }

  acquireDiagnostic(signal: AbortSignal | undefined, intent: DiagnosticReservationIntent): Promise<DiagnosticReservation> {
    const slot: SlotRequest = {
      inventoryHostname: intent.inventoryHostname,
      kind: "diagnostic",
      diagnostic: intent.diagnostic,
      ...(intent.kindDeviceLimit === undefined ? {} : { kindDeviceLimit: intent.kindDeviceLimit })
    };
    return this.enqueue(signal, slot, () => this.reserveDiagnostic(intent));
  }

  private enqueue<TSlot>(signal: AbortSignal | undefined, slot: SlotRequest, reserve: () => TSlot): Promise<TSlot> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
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
      const stopListening = (): void => signal?.removeEventListener("abort", cancelled);
      const waiter: Waiter = {
        ...slot,
        reject: (error) => {
          stopListening();
          reject(error);
        },
        grant: () => {
          stopListening();
          resolve(reserve());
        }
      };
      if (this.hasRoom(waiter)) {
        waiter.grant();
      } else {
        this.waiting.push(waiter);
        signal?.addEventListener("abort", cancelled, { once: true });
      }
    });
  }

  private hasRoom(waiter: Waiter): boolean {
    const diagnosticsHeld = this.diagnosticSlotsHeldBy(waiter.inventoryHostname);
    const readsHeld = this.readsHeldByDevice.get(waiter.inventoryHostname) ?? 0;
    if (waiter.kind === "read") return diagnosticsHeld + readsHeld < this.limits.deviceLimit;
    if (waiter.kindDeviceLimit !== undefined && this.diagnosticSlotsHeldBy(waiter.inventoryHostname, waiter.diagnostic) >= waiter.kindDeviceLimit) {
      return false;
    }
    return this.diagnosticHeadroom(diagnosticsHeld, readsHeld, this.limits.diagnosticServerLimit - this.reservations.size) > 0;
  }

  /** Diagnostic slots a host could take now: the tightest of its diagnostic share, its shared device
   * slots, and the server-wide diagnostic slots still free. Admission and the snapshot both use it.
   */
  private diagnosticHeadroom(diagnosticsHeld: number, readsHeld: number, serverAvailable: number): number {
    const diagnosticShareLeft = this.limits.diagnosticDeviceLimit - diagnosticsHeld;
    const deviceSlotsLeft = this.limits.deviceLimit - diagnosticsHeld - readsHeld;
    return Math.max(0, Math.min(diagnosticShareLeft, deviceSlotsLeft, serverAvailable));
  }

  /** Counted from the held reservations, which never exceed the server-wide diagnostic limit; `diagnostic`
   * narrows the count to one kind.
   */
  private diagnosticSlotsHeldBy(inventoryHostname: string, diagnostic?: string): number {
    let held = 0;
    for (const reservation of this.reservations.keys()) {
      if (reservation.inventory_hostname === inventoryHostname && (diagnostic === undefined || reservation.diagnostic === diagnostic)) held += 1;
    }
    return held;
  }

  private reserveRead(inventoryHostname: string): () => void {
    this.adjustReadsHeld(inventoryHostname, 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.adjustReadsHeld(inventoryHostname, -1);
      this.grantWaiting();
    };
  }

  /** Keeps only hosts that hold reads, so the snapshot lists no idle hosts. */
  private adjustReadsHeld(inventoryHostname: string, change: 1 | -1): void {
    const readsHeld = (this.readsHeldByDevice.get(inventoryHostname) ?? 0) + change;
    if (readsHeld > 0) this.readsHeldByDevice.set(inventoryHostname, readsHeld);
    else this.readsHeldByDevice.delete(inventoryHostname);
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
      markUncertain: (reasonCode) => this.markUncertain(state, reasonCode, intent.uncertainHoldMs)
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

  private markUncertain(state: DiagnosticReservationInfo, reasonCode: string, uncertainHoldMs: number): void {
    if (this.closed || !this.reservations.has(state) || state.state === "uncertain") return;
    const now = Date.now();
    state.state = "uncertain";
    state.uncertain_since = new Date(now).toISOString();
    state.releases_at = new Date(now + uncertainHoldMs).toISOString();
    state.reason_code = reasonCode;
    // Unref so a held slot never keeps a stopping server alive.
    this.reservations.set(state, setTimeout(() => this.freeDiagnostic(state), uncertainHoldMs).unref());
  }
}

/** Limits from config: top-level `deviceConcurrency` per device, `diagnostics.*` for the diagnostic share.
 * A kind's own per-device limit arrives with each request, from its diagnostic definition.
 */
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
