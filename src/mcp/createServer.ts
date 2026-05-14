import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";
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
import { buildShowLoggingToolResult, showLoggingInputSchema } from "./tools/showLogging.js";

interface McpRuntimeDependencies {
  runtimeContext: ServerRuntimeContext;
  inventoryModel: InventoryModel;
  config: ResolvedServerConfig;
  eapiClient: EapiClient;
}

function buildToolDefinitions(deps: McpRuntimeDependencies) {
  return [
    {
      name: "eos_get_server_info",
      description: "Return a sanitized summary of current server capabilities, limits, runtime mode, and inventory summary.",
      inputSchema: getServerInfoInputSchema,
      handler: async () => buildGetServerInfoToolResult(deps.runtimeContext)
    },
    {
      name: "eos_list_inventory",
      description: "Return a sanitized operational view of the loaded inventory. By default only EOS-eligible hosts are shown, while all groups remain visible with actionable status.",
      inputSchema: listInventoryInputSchema,
      handler: async (args: z.infer<typeof listInventoryInputSchema>) => buildListInventoryToolResult(deps.inventoryModel, args)
    },
    {
      name: "eos_probe_devices",
      description: "Probe EOS device readiness for a host or group target by validating connectivity, authentication, and harmless command execution.",
      inputSchema: probeDevicesInputSchema,
      handler: async (args: z.infer<typeof probeDevicesInputSchema>) => buildProbeDevicesToolResult(deps.inventoryModel, deps.config, args, deps.eapiClient)
    },
    {
      name: "eos_run_show",
      description: "Run one or more EOS show commands against a host or group target. Supports auto/json/text output modes with strict show-only validation.",
      inputSchema: runShowInputSchema,
      handler: async (args: z.infer<typeof runShowInputSchema>) => buildRunShowToolResult(deps.inventoryModel, deps.config, args, deps.eapiClient)
    },
    {
      name: "eos_show_logging",
      description: "Retrieve bounded EOS logging output for a host or group target using a minimum severity threshold and message-count limit.",
      inputSchema: showLoggingInputSchema,
      handler: async (args: z.infer<typeof showLoggingInputSchema>) => buildShowLoggingToolResult(deps.inventoryModel, deps.config, args, deps.eapiClient)
    },
    {
      name: "eos_get_facts",
      description: "Collect a fixed core set of EOS device facts for a host or group target.",
      inputSchema: getFactsInputSchema,
      handler: async (args: z.infer<typeof getFactsInputSchema>) => buildGetFactsToolResult(deps.inventoryModel, deps.config, args, deps.eapiClient)
    },
    {
      name: "eos_get_running_config",
      description: "Retrieve running configuration text for a host target, or for a group target when a raw EOS section selector is provided.",
      inputSchema: getRunningConfigInputSchema,
      handler: async (args: z.infer<typeof getRunningConfigInputSchema>) => buildGetRunningConfigToolResult(deps.inventoryModel, deps.config, args, deps.eapiClient)
    }
  ];
}

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

  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (args: unknown) => Promise<unknown>
  ) => void;

  for (const tool of buildToolDefinitions({ runtimeContext, inventoryModel, config, eapiClient })) {
    registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      tool.handler as (args: unknown) => Promise<unknown>
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
