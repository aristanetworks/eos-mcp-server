import { z } from "zod";
import { buildServerInfo } from "../../serverInfo/buildServerInfo.js";
import type { DiagnosticCapacitySnapshot } from "../../diagnostics/types.js";
import type { ServerRuntimeContext } from "../../serverInfo/types.js";
import { buildJsonToolResult } from "../toolResult.js";

export const getServerInfoInputSchema = z.object({}).strict();

export function buildGetServerInfoToolResult(runtimeContext: ServerRuntimeContext, diagnosticCapacity?: DiagnosticCapacitySnapshot) {
  const info = buildServerInfo(runtimeContext, diagnosticCapacity);

  return buildJsonToolResult(info);
}
