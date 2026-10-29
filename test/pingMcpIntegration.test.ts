import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { writeTempInventory } from "./helpers.js";

function writePingInventory() {
  return writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
    "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true",
    "hosts:", "  ping1:", `    ansible_host: ${process.env.EOS_PING_TEST_HOST ?? "172.20.20.11"}`
  ]);
}

function serve(config: string) {
  return new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/index.ts", "serve", "--config", config],
    stderr: "pipe"
  });
}

describe.runIf(process.env.INTEGRATION === "1")("integration: EOS ping over MCP stdio", () => {
  it("loads diagnostic settings and returns real device measurements", async () => {
    const inventory = await writePingInventory();
    const config = await writeTempInventory([`inventory: ${inventory}`, "diagnostics:", "  defaultPingCount: 1", "  deviceConcurrency: 1"]);
    const client = new Client({ name: "ping-integration", version: "1" }, { capabilities: {} });
    try {
      await client.connect(serve(config));
      const result = await client.callTool({ name: "eos_ping", arguments: { target: "ping1", destinations: ["::1"], source: "::1", vrf: "default" } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        request: { kind: "ping", count: 1 },
        summary: { success_count: 1, failed_count: 0 },
        results: [{ status: "success", finding: { reachability: "reachable", packets_sent: 1, packets_received: 1 } }]
      });
      expect(result.structuredContent).not.toHaveProperty("results.0.raw_output");
      const info = await client.callTool({ name: "eos_get_server_info", arguments: {} });
      expect(info.structuredContent).toHaveProperty("limits.diagnostics.default_ping_count", 1);
    } finally {
      await client.close();
    }
  }, 20_000);

  it("reports time-bounded uncertain capacity after a real timeout while a second server runs alongside", async () => {
    const inventory = await writePingInventory();
    const [timeoutConfig, normalConfig] = await Promise.all([
      writeTempInventory([`inventory: ${inventory}`, "diagnostics:", "  deviceConcurrency: 1", "  overallOperationTimeoutMs: 200"]),
      writeTempInventory([`inventory: ${inventory}`, "diagnostics:", "  defaultPingCount: 1", "  deviceConcurrency: 1"])
    ]);
    const first = new Client({ name: "ping-reservation-integration", version: "1" }, { capabilities: {} });
    const second = new Client({ name: "ping-second-server", version: "1" }, { capabilities: {} });
    try {
      await Promise.all([first.connect(serve(timeoutConfig)), second.connect(serve(normalConfig))]);
      const timedOut = await first.callTool({ name: "eos_ping", arguments: { target: "ping1", destinations: ["127.0.0.1"], count: 3 } });
      expect(timedOut.isError).toBe(true);
      const info = await first.callTool({ name: "eos_get_server_info", arguments: {} });
      expect(info.structuredContent).toMatchObject({ diagnostics: { capacity: {
        limit: 1, available_count: 0, active_count: 0, uncertain_count: 1,
        reservations: [{ inventory_hostname: "ping1", diagnostic: "ping", state: "uncertain", reason_code: "operation_timeout", releases_at: expect.any(String) }]
      } } });

      const result = await second.callTool({ name: "eos_ping", arguments: { target: "ping1", destinations: ["127.0.0.1"] } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty("summary.success_count", 1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  }, 20_000);
});
