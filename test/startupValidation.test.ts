import { describe, expect, it } from "vitest";
import { validateStartupConnections } from "../src/connection/validateStartupConnections.js";
import { buildConfig, buildInventoryModel } from "./helpers.js";

describe("validateStartupConnections", () => {
  it("rejects EOS-eligible hosts without complete credentials", () => {
    expect(() => validateStartupConnections(buildConfig(), buildInventoryModel())).toThrow(/leaf1.*username/i);
  });

  it("ignores non-EOS hosts during startup credential validation", () => {
    expect(() =>
      validateStartupConnections(
        buildConfig(),
        buildInventoryModel({
          eligible: false,
          readAllowed: false,
          ineligibilityReasons: ["host is not explicitly marked as EOS eligible"]
        })
      )
    ).not.toThrow();
  });
});
