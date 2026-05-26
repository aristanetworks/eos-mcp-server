import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeTempInventory } from "./helpers.js";

describe("stdio MCP smoke test", () => {
  it(
    "launches the server, lists tools, and calls read-only tools over stdio",
    async () => {
      const inventoryPath = await writeTempInventory([
        "vars:",
        "  ansible_user: admin",
        "  ansible_password: secret",
        "hosts:",
        "  leaf1:",
        "    ansible_host: 10.0.0.11",
        "    ansible_network_os: eos"
      ]);

      const client = new Client(
        { name: "eos-mcp-smoke-test", version: "0.1.0" },
        { capabilities: {} }
      );

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/index.ts", "serve", "--inventory", inventoryPath],
        cwd: process.cwd(),
        stderr: "pipe"
      });

      let stderrOutput = "";
      transport.stderr?.on("data", (chunk) => {
        stderrOutput += chunk.toString();
      });

      try {
        await client.connect(transport);

        const tools = await client.listTools();
        const toolNames = tools.tools.map((tool) => tool.name).sort();

        expect(toolNames).toEqual([
          "eos_get_facts",
          "eos_get_running_config",
          "eos_get_server_info",
          "eos_list_inventory",
          "eos_probe_devices",
          "eos_run_show",
          "eos_show_logging"
        ]);

        // Regression: every tool that takes arguments must advertise a non-empty
        // input schema. A bare `.refine()` / `.superRefine()` on the schema turns
        // the ZodObject into a ZodEffects, which the MCP SDK silently strips down
        // to `{ type: "object", properties: {} }` — leaving callers unable to pass
        // any arguments.
        const toolsWithArgs = [
          "eos_get_facts",
          "eos_get_running_config",
          "eos_probe_devices",
          "eos_run_show",
          "eos_show_logging"
        ];
        for (const name of toolsWithArgs) {
          const tool = tools.tools.find((entry) => entry.name === name);
          expect(tool, `${name} should be advertised`).toBeDefined();
          const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
          expect(properties, `${name} inputSchema.properties must be defined`).toBeDefined();
          expect(
            Object.keys(properties ?? {}),
            `${name} inputSchema.properties must include at least "target"`
          ).toContain("target");
        }

        const serverInfo = await client.callTool({
          name: "eos_get_server_info",
          arguments: {}
        });

        expect(serverInfo.content[0]?.type).toBe("text");
        expect(serverInfo.content[0] && "text" in serverInfo.content[0] ? serverInfo.content[0].text : "").toContain(
          '"runtime_mode": "read-only"'
        );

        const listInventory = (await client.callTool({
          name: "eos_list_inventory",
          arguments: {}
        })) as { structuredContent?: { hosts?: Array<{ inventory_hostname: string }> } };

        expect(listInventory.structuredContent?.hosts?.map((host) => host.inventory_hostname)).toEqual(["leaf1"]);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nSTDERR:\n${stderrOutput}`);
      } finally {
        await client.close();
      }
    },
    20_000
  );
});
