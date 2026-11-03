import { packetCaptureDiagnostic } from "./packetCapture.js";
import { pingDiagnostic } from "./ping.js";
import type { DiagnosticDefinition, DiagnosticRequest } from "./types.js";

export const diagnosticDefinitions: Record<DiagnosticRequest["kind"], DiagnosticDefinition> = {
  ping: pingDiagnostic,
  packet_capture: packetCaptureDiagnostic
};
