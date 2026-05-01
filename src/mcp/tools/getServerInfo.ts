import { z } from "zod";
import { buildServerInfo } from "../../serverInfo/buildServerInfo.js";
import type { ServerRuntimeContext } from "../../serverInfo/types.js";
import { buildJsonToolResult } from "../toolResult.js";

export const getServerInfoInputSchema = z.object({}).strict();

export function buildGetServerInfoToolResult(runtimeContext: ServerRuntimeContext) {
  const info = buildServerInfo(runtimeContext);

  return buildJsonToolResult(info);
}
