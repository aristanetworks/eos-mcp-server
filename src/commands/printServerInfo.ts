import { buildServerInfo } from "../serverInfo/buildServerInfo.js";
import type { ServerRuntimeContext } from "../serverInfo/types.js";
import { prettyJson } from "../utils/json.js";

export function printServerInfo(runtimeContext: ServerRuntimeContext, asJson: boolean): void {
  const info = buildServerInfo(runtimeContext);

  if (asJson) {
    console.log(prettyJson(info));
    return;
  }

  console.log(`Server: ${info.server_name} ${info.server_version}`);
  console.log(`Mode: ${info.runtime_mode}`);
  console.log(`Inventory: ${info.inventory.basename ?? "(none)"}`);
  console.log(`Read timeout (ms): ${info.limits.read_timeout_ms}`);
}
