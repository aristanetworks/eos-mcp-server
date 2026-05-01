import { describe, expect, it } from "vitest";
import { AppError, getErrorCode, toErrorCode, toErrorMessage } from "../src/core/errors.js";

describe("core errors", () => {
  it("preserves code and message for AppError", () => {
    const error = new AppError("test_code", "test message");

    expect(getErrorCode(error)).toBe("test_code");
    expect(toErrorCode(error)).toBe("test_code");
    expect(toErrorMessage(error)).toBe("test message");
  });

  it("falls back for unknown thrown values", () => {
    expect(toErrorCode("boom", "fallback_code")).toBe("fallback_code");
    expect(toErrorMessage("boom")).toBe("boom");
  });
});
