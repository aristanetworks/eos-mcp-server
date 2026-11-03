import { describe, expect, it } from "vitest";
import { EapiDeviceReader } from "../src/connection/eosDeviceReader.js";
import { DiagnosticExecutor } from "../src/diagnostics/executor.js";
import { EapiSlots } from "../src/operations/eapiSlots.js";
import { buildConfig, buildHost, buildInventoryModel, controlledReadRunner, setTestPasswordEnv, stubDiagnosticRunner } from "./helpers.js";

const limits = { deviceLimit: 3, diagnosticDeviceLimit: 2, diagnosticServerLimit: 32 };

function ping(inventoryHostname = "leaf1") {
  return { inventoryHostname, diagnostic: "ping", uncertainHoldMs: 30_000 };
}

/** A kind no diagnostic has, with its own per-device limit: the slots attach no meaning to kind names. */
function limitedKind(inventoryHostname = "leaf1") {
  return { inventoryHostname, diagnostic: "limited", uncertainHoldMs: 12_000, kindDeviceLimit: 1 };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("shared per-device eAPI slots", () => {
  it("keeps a slot free for reads when diagnostics reach their per-device share", async () => {
    const slots = new EapiSlots(limits);
    await slots.acquireDiagnostic(undefined, ping());
    await slots.acquireDiagnostic(undefined, ping());
    let thirdPingGranted = false;
    void slots.acquireDiagnostic(undefined, ping()).then(() => { thirdPingGranted = true; });
    const releaseRead = await slots.acquireRead(undefined, "leaf1");
    await flush();
    expect(thirdPingGranted).toBe(false);
    expect(slots.snapshot().devices).toEqual([{
      inventory_hostname: "leaf1", available_count: 0, active_count: 2, uncertain_count: 0, queued_count: 1,
      read_active_count: 1, read_queued_count: 0, kinds: { ping: { active_count: 2, uncertain_count: 0, queued_count: 1 } }
    }]);
    releaseRead();
    await flush();
    expect(thirdPingGranted).toBe(false);
  });

  it("makes reads and diagnostics share the device limit, serving waiters oldest first", async () => {
    const slots = new EapiSlots(limits);
    const releaseFirstRead = await slots.acquireRead(undefined, "leaf1");
    await slots.acquireRead(undefined, "leaf1");
    await slots.acquireRead(undefined, "leaf1");
    const granted: string[] = [];
    void slots.acquireDiagnostic(undefined, ping()).then(() => granted.push("ping"));
    void slots.acquireRead(undefined, "leaf1").then(() => granted.push("read"));
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
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 });
    await slots.acquireDiagnostic(undefined, ping("leaf1"));
    const releaseRead = await slots.acquireRead(undefined, "leaf2");
    expect(slots.snapshot()).toMatchObject({ available_count: 0, devices: [{ inventory_hostname: "leaf1" }, { inventory_hostname: "leaf2", read_active_count: 1 }] });
    releaseRead();
  });

  it("removes a cancelled read waiter", async () => {
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 });
    await slots.acquireRead(undefined, "leaf1");
    const controller = new AbortController();
    const waiting = slots.acquireRead(controller.signal, "leaf1");
    expect(slots.snapshot().devices[0]?.read_queued_count).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "operation_aborted" });
    expect(slots.snapshot().devices[0]?.read_queued_count).toBe(0);
  });

  it("holds a read slot per request in EapiDeviceReader and frees it when the request settles", async () => {
    setTestPasswordEnv();
    const slots = new EapiSlots({ deviceLimit: 1, diagnosticDeviceLimit: 1, diagnosticServerLimit: 1 });
    const { runner, dispatched } = controlledReadRunner();
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

  it("queues a kind at its own per-device limit without holding up a later ping or read to the device", async () => {
    const slots = new EapiSlots(limits);
    const firstLimited = await slots.acquireDiagnostic(undefined, limitedKind());
    const granted: string[] = [];
    void slots.acquireDiagnostic(undefined, limitedKind()).then(() => granted.push("second limited"));
    void slots.acquireDiagnostic(undefined, ping()).then(() => granted.push("ping"));
    void slots.acquireRead(undefined, "leaf1").then(() => granted.push("read"));
    await flush();
    expect(granted).toEqual(["ping", "read"]);
    firstLimited.complete();
    await flush();
    expect(granted).toEqual(["ping", "read", "second limited"]);
  });

  it("splits each host's diagnostic slots by kind, counting an uncertain slot against its kind's limit", async () => {
    const slots = new EapiSlots(limits);
    const lostLimited = await slots.acquireDiagnostic(undefined, limitedKind());
    lostLimited.markUncertain("eapi_transport_error");
    await slots.acquireDiagnostic(undefined, ping());
    const queuedLimited = slots.acquireDiagnostic(undefined, limitedKind());
    await flush();
    expect(slots.snapshot()).toMatchObject({ active_count: 1, uncertain_count: 1, queued_count: 1 });
    expect(slots.snapshot().devices).toEqual([{
      inventory_hostname: "leaf1", available_count: 0, active_count: 1, uncertain_count: 1, queued_count: 1,
      read_active_count: 0, read_queued_count: 0,
      kinds: {
        limited: { active_count: 0, uncertain_count: 1, queued_count: 1 },
        ping: { active_count: 1, uncertain_count: 0, queued_count: 0 }
      }
    }]);
    slots.close();
    await expect(queuedLimited).rejects.toMatchObject({ code: "diagnostic_server_stopping" });
  });

  it("stays open for reads when a diagnostic executor sharing it closes, and rejects waiters only when the slots close", async () => {
    const slots = new EapiSlots({ ...limits, deviceLimit: 1 });
    const executor = new DiagnosticExecutor(
      buildInventoryModel({ diagnosticsAllowed: true }), buildConfig(), stubDiagnosticRunner({ end: "output", output: "" }), slots
    );
    executor.close();
    const releaseHeldRead = await slots.acquireRead(undefined, "leaf1");
    const queuedRead = slots.acquireRead(undefined, "leaf1");
    const queuedReadOutcome = expect(queuedRead).rejects.toMatchObject({ code: "diagnostic_server_stopping" });
    await flush();
    expect(slots.snapshot().devices).toMatchObject([{ inventory_hostname: "leaf1", read_active_count: 1, read_queued_count: 1 }]);
    slots.close();
    await queuedReadOutcome;
    releaseHeldRead();
  });
});
