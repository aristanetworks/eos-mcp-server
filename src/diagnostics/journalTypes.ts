import type { DiagnosticReservationInfo } from "./types.js";

/** Write-ahead storage: save/remove return only after the durable change commits. */
export interface DiagnosticJournal {
  load(): DiagnosticReservationInfo[];
  save(reservation: DiagnosticReservationInfo): void;
  remove(reservationId: string): void;
  close(): void;
}
