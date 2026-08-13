import { describe, expect, it, vi } from "vitest";
import {
  buildReadOperationResultEnvelope,
  runWithOperationTimeout,
  type ExecuteReadOperationResult,
  type ReadDeviceResultBase
} from "../src/operations/readExecution.js";
import type { InventoryHostModel } from "../src/inventory/types.js";
import { buildConfig } from "./helpers.js";

describe("runWithOperationTimeout", () => {
  it("rejects with operation_timeout and aborts the operation signal", async () => {
    vi.useFakeTimers();
    const abortSeen = vi.fn();

    try {
      const operation = runWithOperationTimeout(
        buildConfig({ overallOperationTimeoutMs: 10 }),
        "test_operation",
        async (signal) => {
          signal.addEventListener("abort", abortSeen, { once: true });
          await new Promise(() => undefined);
        }
      );
      const expectation = expect(operation).rejects.toMatchObject({ code: "operation_timeout" });

      await vi.advanceTimersByTimeAsync(10);

      await expectation;
      expect(abortSeen).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("buildReadOperationResultEnvelope", () => {
  it("enforces the response size limit on the final envelope", () => {
    const host: InventoryHostModel = {
      inventoryHostname: "leaf1",
      resolvedEndpoint: "10.0.0.11",
      effectiveVars: {},
      eligible: true,
      readAllowed: true,
      ineligibilityReasons: [],
      groupMemberships: []
    };
    const operation: ExecuteReadOperationResult<ReadDeviceResultBase & { payload: string }> = {
      resolvedTarget: {
        target: "leaf1",
        targetType: "host",
        resolvedHosts: [host]
      },
      results: [
        {
          inventory_hostname: "leaf1",
          resolved_endpoint: "10.0.0.11",
          status: "success",
          payload: "x".repeat(1_000)
        }
      ],
      summary: {
        total_count: 1,
        success_count: 1,
        failed_count: 0
      }
    };

    expect(() =>
      buildReadOperationResultEnvelope("leaf1", operation, {
        responseSizeLimit: {
          config: buildConfig({ maxResponseSizeBytes: 500 }),
          operationName: "test_read"
        }
      })
    ).toThrow(/response.size/i);
  });
});
