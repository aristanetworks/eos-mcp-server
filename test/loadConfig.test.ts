import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/config/loadConfig.js";
import { AppError } from "../src/core/errors.js";

async function writeTempConfig(lines: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eos-mcp-config-test-"));
  const filePath = path.join(dir, "config.yml");
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

describe("loadServerConfig", () => {
  it("uses read-operation defaults", async () => {
    const config = await loadServerConfig({ command: "serve" });

    expect(config.readTimeoutMs).toBe(10_000);
    expect(config.maxLoggingMessagesPerRequest).toBe(1000);
  });

  it("requests the latest eAPI output version by default", async () => {
    const config = await loadServerConfig({ command: "serve" });

    expect(config.eapiVersion).toBe("latest");
  });

  it("allows pinning the eAPI output version to 1", async () => {
    const configPath = await writeTempConfig(["eapiVersion: 1"]);

    const config = await loadServerConfig({ command: "serve", configPath });

    expect(config.eapiVersion).toBe(1);
  });

  it.each(["eapiVersion: 2", 'eapiVersion: "1"'])("rejects unsupported eAPI output version (%s)", async (configLine) => {
    const configPath = await writeTempConfig([configLine]);

    await expect(loadServerConfig({ command: "serve", configPath })).rejects.toMatchObject({
      code: "config_schema_invalid"
    } satisfies Partial<AppError>);
  });

  it("loads the logging message-count limit from config", async () => {
    const configPath = await writeTempConfig(["maxLoggingMessagesPerRequest: 250"]);

    const config = await loadServerConfig({ command: "serve", configPath });

    expect(config.maxLoggingMessagesPerRequest).toBe(250);
  });

  it("rejects logging message-count limits beyond EOS command bounds", async () => {
    const configPath = await writeTempConfig(["maxLoggingMessagesPerRequest: 10000"]);

    await expect(loadServerConfig({ command: "serve", configPath })).rejects.toMatchObject({
      code: "config_schema_invalid"
    } satisfies Partial<AppError>);
  });

  it("rejects unknown config keys", async () => {
    const configPath = await writeTempConfig(["unknownKey: true"]);

    await expect(loadServerConfig({ command: "serve", configPath })).rejects.toMatchObject({
      code: "config_schema_invalid"
    } satisfies Partial<AppError>);
  });
});
