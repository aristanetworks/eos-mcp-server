import { z } from "zod";
import type { DiagnosticReservationInfo } from "./types.js";

export const reservationSchema = z.object({
  reservation_id: z.string().min(1),
  rpc_request_id: z.string().min(1).optional(),
  inventory_hostname: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  diagnostic: z.literal("ping"),
  state: z.enum(["active", "uncertain"]),
  reserved_at: z.string().datetime(),
  uncertain_since: z.string().datetime().optional(),
  reason_code: z.string().min(1).optional()
}).strict().refine((value) => value.rpc_request_id === undefined || value.rpc_request_id === value.reservation_id,
  { message: "RPC request ID must match the reserved attempt identity" });

export function parseReservation(value: unknown): DiagnosticReservationInfo {
  const reservation = reservationSchema.parse(value);
  const { uncertain_since: since, reason_code: reason, rpc_request_id: requestId, ...required } = reservation;
  return { ...required, ...(since === undefined ? {} : { uncertain_since: since }), ...(reason === undefined ? {} : { reason_code: reason }),
    ...(requestId === undefined ? {} : { rpc_request_id: requestId }) };
}
