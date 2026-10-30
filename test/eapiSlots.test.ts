import { describe, expect, it } from "vitest";
import { EapiDeviceReader } from "../src/connection/eosDeviceReader.js";
import type { EosCommandResult, EosCommandRunner } from "../src/eapi/types.js";
import { EapiSlots } from "../src/operations/eapiSlots.js";
import { buildConfig, buildHost, setTestPasswordEnv } from "./helpers.js";

const limits = { deviceLimit: 3, diagnosticDeviceLimit: 2, diagnosticServerLimit: 32 };
const neverAborted = new AbortController().signal;
const showVersion: EosCommandResult = { command: "show version", output_format: "json", output: {} };

function ping(inventoryHostname = "leaf1") {
  return { inventoryHostname, diagnostic: "ping" as const };
}

/** Runner whose requests stay pending until the test settles them, in dispatch order. */
function controlledRunner() {
  const dispatched: Array<{ hostname: string; settle: () => void }> = [];
  const runner: EosCommandRunner = {
    runShowCommands: (connection) => new Promise((resolve) => {
      dispatched.push({ hostname: connection.inventoryHostname, settle: () => resolve([showVersion]) });
    })
  };
  return { runner, dispatched };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("shared per-device eAPI slots", () => {
  it("keeps a slot free for reads when diagnostics reach their per-device share", async () => {
    const slots = new EapiSlots(limits, 30_000);
    await slots.acquireDiagnostic(neverAborted, ping());
    await slots.acquireDiagnostic(neverAborted, ping());
    let thirdPingGranted = false;
    void slots.acquireDiagnostic(neverAborted, ping()).then(() => { thirdPingGranted = true; });
    const releaseRead = await slots.acquireRead(neverAborted, "leaf1");
    await flush();
    expect(thirdPingGranted).toBe(false);
    expect(slots.snapshot().devices).toEqual([{
      inventory_hostname: "leaf1", available_count: 0, active_count: 2, uncertain_count: 0, queued_count: 1,
      read_active_count: 1, read_queued_count: 0
    }]);
    releaseRead();
    await flush();
    expect(thirdPingGranted).toBe(false);
  });

  it("makes reads and diagnostics share the device limit, serving waiters oldest first", async () => {
    const slots = new EapiSlots(limits, 30_000);
    const releaseFirstRead = await slots.acquireRead(neverAborted, "leaf1");
    await slots.acquireRead(neverAborted, "leaf1");
    await slots.acquireRead(neverAborted, "leaf1");
    const granted: string[] = [];
    void slots.acquireDiagnostic(neverAborted, ping()).then(() => granted.push("ping"));
    void slots.acquireRead(neverAborted, "leaf1").then(() => granted.push("read"));
    await flush();
    expect(granted).toEqual([]);
    expect(slots.snapshot()).toMatchObject({
      eapi_device_limit: 3, queued_count: 1,
      devices: [{ inventory_hostname: "leaf1", available_count: 0, read_active_count: 3, queued_count: 1, read_queued_count: 1 }]
    });
    // A second release of the same slot must not free another one.
    releaseFirstRead();
    releaseFirstRead();
    await flush();
    expect(granted).toEqual(["ping"]);
  });

  it("does not limit reads on one device by diagnostics on another", async () => {
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 }, 30_000);
    await slots.acquireDiagnostic(neverAborted, ping("leaf1"));
    const releaseRead = await slots.acquireRead(neverAborted, "leaf2");
    expect(slots.snapshot()).toMatchObject({ available_count: 0, devices: [{ inventory_hostname: "leaf1" }, { inventory_hostname: "leaf2", read_active_count: 1 }] });
    releaseRead();
  });

  it("removes a cancelled read waiter", async () => {
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 }, 30_000);
    await slots.acquireRead(neverAborted, "leaf1");
    const controller = new AbortController();
    const waiting = slots.acquireRead(controller.signal, "leaf1");
    expect(slots.snapshot().devices[0]?.read_queued_count).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "operation_aborted" });
    expect(slots.snapshot().devices[0]?.read_queued_count).toBe(0);
  });

  it("holds a read slot per request in EapiDeviceReader and frees it when the request settles", async () => {
    setTestPasswordEnv();
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 }, 30_000);
    const { runner, dispatched } = controlledRunner();
    const reader = new EapiDeviceReader(buildConfig({ defaultConnection: { ansibleUser: "admin", mcpPasswordEnv: "EOS_MCP_PASSWORD" } }), runner, slots);
    const host = buildHost({ inventoryHostname: "leaf1", resolvedEndpoint: "10.0.0.11" });
    const first = reader.runShowCommands(host, ["show version"], "json");
    const second = reader.runShowCommands(host, ["show version"], "json");
    await flush();
    expect(dispatched).toHaveLength(1);
    expect(slots.snapshot().devices).toMatchObject([{ read_active_count: 1, read_queued_count: 1 }]);
    dispatched[0]?.settle();
    await first;
    await flush();
    expect(dispatched).toHaveLength(2);
    dispatched[1]?.settle();
    await second;
    expect(slots.snapshot().devices).toEqual([]);
  });
});
