import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { writeTempInventory } from "./helpers.js";

describe.runIf(process.env.INTEGRATION === "1")("integration: EOS ping over MCP stdio", () => {
  it("loads diagnostic settings and returns real device measurements", async () => {
    const inventory = await writeTempInventory([
      "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
      "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true",
      "hosts:", "  ping1:", `    ansible_host: ${process.env.EOS_PING_TEST_HOST ?? "172.20.20.11"}`
    ]);
    const config = await writeTempInventory([`inventory: ${inventory}`, "diagnostics:", "  stateFile: diagnostics.sqlite", "  defaultPingCount: 1", "  deviceConcurrency: 1"]);
    const client = new Client({ name: "ping-integration", version: "1" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/index.ts", "serve", "--config", config],
      stderr: "pipe"
    });
    try {
      await client.connect(transport);
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

  it("reports uncertain capacity after a real timeout and returns a structured capacity error", async () => {
    const inventory = await writeTempInventory([
      "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
      "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true",
      "hosts:", "  ping1:", `    ansible_host: ${process.env.EOS_PING_TEST_HOST ?? "172.20.20.11"}`
    ]);
    const config = await writeTempInventory([
      `inventory: ${inventory}`, "diagnostics:", "  stateFile: diagnostics.sqlite", "  deviceConcurrency: 1", "  overallOperationTimeoutMs: 200"
    ]);
    let retainedRequestId: string | undefined;
    const client = new Client({ name: "ping-reservation-integration", version: "1" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/index.ts", "serve", "--config", config],
      stderr: "pipe"
    });
    try {
      await client.connect(transport);
      const args = { target: "ping1", destinations: ["127.0.0.1"], count: 3 };
      const timedOut = await client.callTool({ name: "eos_ping", arguments: args });
      expect(timedOut.isError).toBe(true);
      const info = await client.callTool({ name: "eos_get_server_info", arguments: {} });
      expect(info.structuredContent).toMatchObject({ diagnostics: { capacity: {
        scope: "state-file", limit: 1, available_count: 0, active_count: 0, uncertain_count: 1,
        reservations: [{ inventory_hostname: "ping1", diagnostic: "ping", state: "uncertain", reason_code: "operation_timeout" }]
      } } });
      const capacity = info.structuredContent as { diagnostics?: { capacity?: { reservations?: Array<{ reservation_id: string; rpc_request_id?: string }> } } };
      retainedRequestId = capacity.diagnostics?.capacity?.reservations?.[0]?.rpc_request_id;
      expect(retainedRequestId).toEqual(expect.any(String));
      expect(capacity.diagnostics?.capacity?.reservations?.[0]?.reservation_id).toBe(retainedRequestId);
      const blocked = await client.callTool({ name: "eos_ping", arguments: args });
      expect(blocked).toMatchObject({ isError: true, structuredContent: { error_code: "diagnostic_capacity_uncertain" } });
    } finally {
      await client.close();
    }
    const restarted = new Client({ name: "ping-restarted", version: "1" }, { capabilities: {} });
    try {
      await restarted.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/index.ts", "serve", "--config", config],
        stderr: "pipe"
      }));
      const info = await restarted.callTool({ name: "eos_get_server_info", arguments: {} });
      expect(info.structuredContent).toHaveProperty("diagnostics.capacity.uncertain_count", 1);
      expect(info.structuredContent).toHaveProperty("diagnostics.capacity.reservations.0.rpc_request_id", retainedRequestId);
      const blocked = await restarted.callTool({ name: "eos_ping", arguments: { target: "ping1", destinations: ["127.0.0.1"] } });
      expect(blocked).toMatchObject({ isError: true, structuredContent: { error_code: "diagnostic_capacity_uncertain" } });
    } finally { await restarted.close(); }
  }, 20_000);
});
