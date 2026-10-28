import { describe, expect, it } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

// Read-only tests against clab/testlab.clab.yaml; never change device configuration.
// Addresses can be overridden for an equivalent isolated lab.
async function executor(overallOperationTimeoutMs = 60_000) {
  const model = await loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
    "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true",
    "hosts:", "  ping1:", `    ansible_host: ${process.env.EOS_PING_TEST_HOST ?? "172.20.20.11"}`,
    "  ping2:", `    ansible_host: ${process.env.EOS_PING_TEST_HOST_2 ?? "172.20.20.12"}`,
    "groups:", "  switches:", "    hosts: [ping1, ping2]"
  ]));
  const config = buildConfig();
  config.diagnostics.overallOperationTimeoutMs = overallOperationTimeoutMs;
  return new DiagnosticExecutor(model, config, new EapiDiagnosticRunner(config, new EapiClient()));
}

describe.runIf(process.env.INTEGRATION === "1")("integration: bounded EOS ping (cEOS 4.34.3M)", () => {
  it.each([
    { destination: "127.0.0.1", source: "127.0.0.1" },
    { destination: "::1", source: "::1" }
  ])("executes $destination with explicit VRF/source and parses measurements", async (addresses) => {
    const result = await (await executor()).execute({ target: "ping1", request: { kind: "ping", destinations: [addresses.destination], source: addresses.source, vrf: "default", count: 2 }, includeRaw: true });
    expect(result.results[0]).toMatchObject({ status: "success", finding: { reachability: "reachable", packets_sent: 2, packets_received: 2 } });
    expect(result.results[0]?.finding?.rtt_ms).not.toBeNull();
    expect(result.results[0]?.raw_output).toContain("ping statistics");
  }, 15_000);

  it("fans out through the shared executor", async () => {
    const result = await (await executor()).execute({ target: "switches", request: { kind: "ping", destinations: ["127.0.0.1"], count: 1 } });
    expect(result.summary).toEqual({ total_count: 2, success_count: 2, failed_count: 0 });
    expect(result.results.every((device) => device.finding?.reachability === "reachable")).toBe(true);
  }, 15_000);

  it("reports a silent destination as unreachable, not an execution failure", async () => {
    const result = await (await executor()).execute({ target: "ping1", request: { kind: "ping", destinations: [process.env.EOS_PING_TEST_SILENT_HOST ?? "172.20.20.254"], vrf: "MGMT", count: 2 } });
    expect(result.results[0]).toMatchObject({ status: "success", finding: { reachability: "unreachable", packets_sent: 2, packets_received: 0, packet_loss_percent: 100, rtt_ms: null } });
  }, 15_000);

  it("does not fall back when a requested VRF or source is invalid", async () => {
    const execute = await executor();
    const missingVrf = await execute.execute({ target: "ping1", request: { kind: "ping", destinations: ["127.0.0.1"], vrf: "definitely_missing", count: 1 } });
    expect(missingVrf.results[0]).toMatchObject({ status: "failed", error_code: "eapi_json_rpc_error" });
    const missingSource = await execute.execute({ target: "ping1", request: { kind: "ping", destinations: ["127.0.0.1"], source: "192.0.2.50", count: 1 } });
    expect(missingSource.results[0]).toMatchObject({ status: "failed", error_code: "diagnostic_command_failed" });
  }, 15_000);

  it("aborts HTTP work at the configured overall deadline", async () => {
    await expect((await executor(100)).execute({ target: "switches", request: { kind: "ping", destinations: ["127.0.0.1"], count: 3 } }))
      .rejects.toMatchObject({ code: "operation_timeout" });
  }, 15_000);
});
