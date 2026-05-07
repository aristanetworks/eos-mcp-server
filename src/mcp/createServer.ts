import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { APP_NAME, APP_VERSION } from "../core/version.js";
import { EapiClient } from "../eapi/client.js";
import type { InventoryModel } from "../inventory/types.js";
import type { ServerRuntimeContext } from "../serverInfo/types.js";
import { buildGetFactsToolResult, getFactsInputSchema } from "./tools/getFacts.js";
import { buildGetRunningConfigToolResult, getRunningConfigInputSchema } from "./tools/getRunningConfig.js";
import { buildGetServerInfoToolResult, getServerInfoInputSchema } from "./tools/getServerInfo.js";
import { buildListInventoryToolResult, listInventoryInputSchema } from "./tools/listInventory.js";
import { buildProbeDevicesToolResult, probeDevicesInputSchema } from "./tools/probeDevices.js";
import { buildRunShowToolResult, runShowInputSchema } from "./tools/runShow.js";

export async function startMcpServer(config: ResolvedServerConfig, inventoryModel: InventoryModel): Promise<void> {
  const runtimeContext: ServerRuntimeContext = {
    instanceId: randomUUID(),
    startedAt: new Date().toISOString(),
    config,
    inventorySummary: inventoryModel.summary,
    writePathStatus: "idle"
  };

  const eapiClient = new EapiClient();

  const server = new McpServer({
    name: APP_NAME,
    version: APP_VERSION
  });

  server.registerTool(
    "eos_get_server_info",
    {
      description: "Return a sanitized summary of current server capabilities, limits, runtime mode, and inventory summary.",
      inputSchema: getServerInfoInputSchema
    },
    async () => buildGetServerInfoToolResult(runtimeContext)
  );

  server.registerTool(
    "eos_list_inventory",
    {
      description: "Return a sanitized operational view of the loaded inventory. By default only EOS-eligible hosts are shown, while all groups remain visible with actionable status.",
      inputSchema: listInventoryInputSchema
    },
    async (args) => buildListInventoryToolResult(inventoryModel, args)
  );

  server.registerTool(
    "eos_probe_devices",
    {
      description: "Probe EOS device readiness for a host or group target by validating connectivity, authentication, and harmless command execution.",
      inputSchema: probeDevicesInputSchema
    },
    async (args) => buildProbeDevicesToolResult(inventoryModel, config, args, eapiClient)
  );

  server.registerTool(
    "eos_run_show",
    {
      description: "Run one or more EOS show commands against a host or group target. Supports auto/json/text output modes with strict show-only validation.",
      inputSchema: runShowInputSchema
    },
    async (args) => buildRunShowToolResult(inventoryModel, config, args, eapiClient)
  );

  server.registerTool(
    "eos_get_facts",
    {
      description: "Collect a fixed core set of EOS device facts for a host or group target.",
      inputSchema: getFactsInputSchema
    },
    async (args) => buildGetFactsToolResult(inventoryModel, config, args, eapiClient)
  );

  server.registerTool(
    "eos_get_running_config",
    {
      description: "Retrieve running configuration text for a host target, or for a group target when a raw EOS section selector is provided.",
      inputSchema: getRunningConfigInputSchema
    },
    async (args) => buildGetRunningConfigToolResult(inventoryModel, config, args, eapiClient)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
