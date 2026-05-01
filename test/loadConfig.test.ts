import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/config/loadConfig.js";

async function writeTempConfig(lines: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eos-mcp-config-test-"));
  const filePath = path.join(dir, "config.yml");
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

describe("loadServerConfig", () => {
  it("keeps the server read-only by default", async () => {
    const config = await loadServerConfig({ command: "serve" });

    expect(config.enableWrite).toBe(false);
    expect(config.allowDirectConfigFallback).toBe(false);
  });

  it("rejects --enable-write for the read-only MVP", async () => {
    await expect(loadServerConfig({ command: "serve", enableWrite: true })).rejects.toThrow(
      "enableWrite is not supported in the read-only MVP"
    );
  });

  it("rejects enableWrite in the config file for the read-only MVP", async () => {
    const configPath = await writeTempConfig(["enableWrite: true"]);

    await expect(loadServerConfig({ command: "serve", configPath })).rejects.toThrow(
      "enableWrite is not supported in the read-only MVP"
    );
  });

  it("rejects allowDirectConfigFallback in the config file for the read-only MVP", async () => {
    const configPath = await writeTempConfig(["allowDirectConfigFallback: true"]);

    await expect(loadServerConfig({ command: "serve", configPath })).rejects.toThrow(
      "allowDirectConfigFallback is not supported in the read-only MVP"
    );
  });
});
