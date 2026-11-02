import { describe, expect, it } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildConfig, writeTempInventory } from "./helpers.js";

// Read-only tests against clab/testlab.clab.yaml; never change device configuration.
// node1-1 Ethernet1 (10.255.255.0/31) links to node2-1 Ethernet1 (10.255.255.1/31); node2-1 has no Ethernet6,
// while node1-1 Ethernet6 carries BFD to node2-6. Addresses can be overridden for an equivalent isolated lab.
const captureHostAddress = process.env.EOS_CAPTURE_TEST_HOST ?? "172.20.20.11";
const peerHostAddress = process.env.EOS_CAPTURE_TEST_PEER ?? "172.20.20.21";
const captureHostLinkAddress = process.env.EOS_CAPTURE_TEST_LINK_ADDRESS ?? "10.255.255.0";

async function executor() {
  const model = await loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
    "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true", "  mcp_packet_capture_allowed: true",
    "hosts:", "  capture1:", `    ansible_host: ${captureHostAddress}`,
    "  peer1:", `    ansible_host: ${peerHostAddress}`,
    "groups:", "  pair:", "    hosts: [capture1, peer1]"
  ]));
  const config = buildConfig();
  return new DiagnosticExecutor(model, config, new EapiDiagnosticRunner(config, new EapiClient()));
}

describe.runIf(process.env.INTEGRATION === "1")("integration: bounded EOS packet capture (cEOS 4.34.3M)", () => {
  it("returns exactly packet_count packets captured while the neighbor pings", async () => {
    const execute = await executor();
    const [capture, ping] = await Promise.all([
      execute.execute({ target: "capture1", request: { kind: "packet_capture", interface: "Ethernet1", filter: "icmp", packet_count: 4, window_seconds: 10 } }),
      execute.execute({ target: "peer1", request: { kind: "ping", destinations: [captureHostLinkAddress], count: 5 } })
    ]);
    expect(ping.results[0]?.finding).toMatchObject({ reachability: "reachable" });
    expect(capture.results[0]).toMatchObject({
      status: "success",
      finding: { kind: "packet_capture", capture: "complete", requested_packet_count: 4, window_seconds: 10 }
    });
    const finding = capture.results[0]?.finding;
    const packets = finding?.kind === "packet_capture" ? finding.packets : [];
    expect(packets).toHaveLength(4);
    expect(packets.every((line) => line.includes("ICMP echo"))).toBe(true);
    expect(execute.getCapacity()).toMatchObject({ active_count: 0, uncertain_count: 0 });
  }, 20_000);

  it("fails only the group entry whose host lacks the interface", async () => {
    const result = await (await executor()).execute({ target: "pair", request: { kind: "packet_capture", interface: "Ethernet6", packet_count: 2, window_seconds: 5 } });
    expect(result.summary).toEqual({ total_count: 2, success_count: 1, failed_count: 1 });
    expect(result.results[0]).toMatchObject({ inventory_hostname: "capture1", status: "success", finding: { capture: "complete" } });
    expect(result.results[1]).toMatchObject({ inventory_hostname: "peer1", status: "failed", error_code: "eapi_json_rpc_error" });
  }, 20_000);

  it("is stopped by the device timer at its window and reports an unfilled finding, freeing the slot at once", async () => {
    const execute = await executor();
    const startedAt = Date.now();
    const result = await execute.execute({ target: "capture1", request: { kind: "packet_capture", interface: "Ethernet1", filter: "udp port 9", packet_count: 1, window_seconds: 2 } });
    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(elapsedMs).toBeLessThan(5000);
    expect(result.results[0]).toEqual({
      inventory_hostname: "capture1", resolved_endpoint: captureHostAddress, status: "success",
      finding: { kind: "packet_capture", capture: "unfilled", requested_packet_count: 1, window_seconds: 2, packets: [] }
    });
    expect(execute.getCapacity()).toMatchObject({ active_count: 0, uncertain_count: 0, reservations: [] });
  }, 20_000);
});
