import { describe, expect, it, vi } from "vitest";
import { runWithOperationTimeout } from "../src/operations/readExecution.js";
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
