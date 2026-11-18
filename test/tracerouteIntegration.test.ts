import { describe, expect, it } from "vitest";
import { EapiClient } from "../src/eapi/client.js";
import { EapiDiagnosticRunner } from "../src/diagnostics/eapiRunner.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { loadInventoryModel } from "../src/inventory/loadInventory.js";
import { buildConfig, buildEapiSlots, writeTempInventory } from "./helpers.js";

// Read-only tests against clab/testlab.clab.yaml; never change device configuration.
// The destination is node2-2's Loopback0 and the source node2-1's, so the answering path has two hops.
const traceHost = process.env.EOS_TRACEROUTE_TEST_HOST ?? process.env.EOS_PING_TEST_HOST ?? "172.20.20.11";
const traceDestination = process.env.EOS_TRACEROUTE_TEST_DESTINATION ?? "10.255.0.4";
const traceSource = process.env.EOS_TRACEROUTE_TEST_SOURCE ?? "10.255.0.3";

async function executor() {
  const model = await loadInventoryModel(await writeTempInventory([
    "vars:", "  ansible_network_os: eos", "  ansible_user: admin", "  ansible_password: admin",
    "  mcp_validate_certs: false", "  mcp_diagnostics_allowed: true",
    "hosts:", "  trace1:", `    ansible_host: ${traceHost}`
  ]));
  const config = buildConfig();
  return new DiagnosticExecutor(model, config, new EapiDiagnosticRunner(config, new EapiClient()), buildEapiSlots(config));
}

describe.runIf(process.env.INTEGRATION === "1")("integration: bounded EOS traceroute (cEOS 4.34.3M)", () => {
  it("reaches a loopback destination over two hops when source is a loopback", async () => {
    const result = await (await executor()).execute({
      target: "trace1", request: { kind: "traceroute", destinations: [traceDestination], source: traceSource }, includeRaw: true
    });
    expect(result.results[0]).toMatchObject({
      status: "success", destination: traceDestination,
      finding: { kind: "traceroute", path: "reached", resolved_address: traceDestination }
    });
    const finding = result.results[0]?.finding;
    expect(finding?.kind === "traceroute" ? finding.hops : []).toHaveLength(2);
    expect(result.results[0]?.raw_output).toContain("traceroute to");
  }, 30_000);

  it("traces a name resolved on the device", async () => {
    const result = await (await executor()).execute({ target: "trace1", request: { kind: "traceroute", destinations: ["localhost"] } });
    expect(result.results[0]).toMatchObject({ status: "success", finding: { path: "reached", resolved_address: "127.0.0.1" } });
  }, 45_000);

  it("fails an unresolvable name as an execution failure", async () => {
    const result = await (await executor()).execute({ target: "trace1", request: { kind: "traceroute", destinations: ["nosuch.invalid"] } });
    expect(result.results[0]).toMatchObject({ status: "failed", error_code: "diagnostic_destination_unresolved" });
  }, 45_000);

  // Without source, replies to the interface address have no return route past the directly connected neighbor:
  // hop 1 answers and hops 2 to 30 are silent. That takes about 30 s, so it runs only in the slow suite.
  it.runIf(process.env.EOS_TRACEROUTE_SLOW === "1")("reports a path that goes silent after hop 1 as unreached with all 30 hops", async () => {
    const result = await (await executor()).execute({ target: "trace1", request: { kind: "traceroute", destinations: [traceDestination] } });
    expect(result.results[0]).toMatchObject({ status: "success", finding: { kind: "traceroute", path: "unreached", resolved_address: traceDestination } });
    const finding = result.results[0]?.finding;
    const hops = finding?.kind === "traceroute" ? finding.hops : [];
    expect(hops.map((hop) => hop.hop)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(hops[0]?.responses.some((response) => response !== null)).toBe(true);
    expect(hops.slice(1).map((hop) => hop.responses)).toEqual(Array.from({ length: 29 }, () => [null, null, null]));
    const responders = hops.flatMap((hop) => hop.responses).flatMap((response) => (response === null ? [] : [response.address]));
    expect(responders).not.toContain(traceDestination);
  }, 90_000);
});
