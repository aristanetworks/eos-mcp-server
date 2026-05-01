import { prettyJson } from "../utils/json.js";

export function buildJsonToolResult<TPayload>(payload: TPayload) {
  return {
    content: [
      {
        type: "text" as const,
        text: prettyJson(payload)
      }
    ],
    structuredContent: payload as unknown as Record<string, unknown>
  };
}
