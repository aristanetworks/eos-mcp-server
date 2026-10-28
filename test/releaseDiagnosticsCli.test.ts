import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { runReleaseDiagnostics } from "../src/commands/releaseDiagnostics.js";
import { inspectDiagnosticJournal } from "../src/diagnostics/journal.js";
import { buildConfig } from "./helpers.js";
import { operatorReleaseFixture } from "./fixtures/operatorRelease.js";

async function fixture() {
  const item = await operatorReleaseFixture();
  const evidenceFile = path.join(path.dirname(item.file), "evidence.json");
  await fs.writeFile(evidenceFile, JSON.stringify(item.evidence), { mode: 0o600 });
  const config = buildConfig({ inventoryPath: undefined });
  config.diagnostics.stateFile = item.file;
  return { ...item, evidenceFile, config };
}

describe("operator release CLI", () => {
  it("commits through the actual CLI and makes the audit available through read-only inspection", async () => {
    const { file, id, otherId, evidenceFile } = await fixture();
    const configFile = path.join(path.dirname(file), "config.yml");
    await fs.writeFile(configFile, `diagnostics:\n  stateFile: ${JSON.stringify(file)}\n`);
    const run = promisify(execFile);
    const { stdout } = await run(process.execPath, ["--import", "tsx", "src/index.ts", "release-diagnostics", "--config", configFile,
      "--reservation-id", id, "--evidence-file", evidenceFile, "--confirm-fenced", "--json"]);
    expect(JSON.parse(stdout)).toMatchObject({ authority: "operator_attestation", released_reservation_ids: [id], already_committed: false });
    const inspected = await run(process.execPath, ["--import", "tsx", "src/index.ts", "inspect-diagnostics", "--config", configFile, "--json"]);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ schema_version: 2, unresolved_count: 1,
      reservations: [{ reservation_id: otherId }], release_audit: [{ authority: "operator_attestation", released_reservations: [{ reservation_id: id }] }] });
  });

  it.each(["confirmation", "IDs", "evidence path", "invalid JSON", "duplicate JSON key", "unknown evidence field", "oversized", "invalid UTF8", "missing file", "directory"])("rejects %s before changing ledger state", async (condition) => {
    const { file, id, evidence, evidenceFile, config } = await fixture();
    const options = { reservationIds: [id], evidenceFile, confirmFenced: true, json: true };
    if (condition === "confirmation") options.confirmFenced = false;
    if (condition === "IDs") options.reservationIds = [];
    if (condition === "evidence path") options.evidenceFile = "";
    if (condition === "invalid JSON") await fs.writeFile(evidenceFile, "{broken");
    if (condition === "duplicate JSON key") await fs.writeFile(evidenceFile, JSON.stringify(evidence).replace('"reason":', '"reason":"first value","reason":'));
    if (condition === "unknown evidence field") await fs.writeFile(evidenceFile, JSON.stringify({ ...evidence, force: true }));
    if (condition === "oversized") await fs.writeFile(evidenceFile, `${" ".repeat(65_537)}${JSON.stringify(evidence)}`);
    if (condition === "invalid UTF8") await fs.writeFile(evidenceFile, Buffer.from([255, 254]));
    if (condition === "missing file") await fs.unlink(evidenceFile);
    if (condition === "directory") options.evidenceFile = path.dirname(file);
    const before = inspectDiagnosticJournal(file);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await runReleaseDiagnostics(config, options)).toBe(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0])).error_code).toEqual(expect.any(String));
      expect(inspectDiagnosticJournal(file)).toEqual(before);
    } finally { log.mockRestore(); }
  });

  it.skipIf(process.platform === "win32")("rejects public, linked, or symlink evidence files", async () => {
    const { file, id, evidenceFile, config } = await fixture();
    const options = { reservationIds: [id], evidenceFile, confirmFenced: true, json: true };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await fs.chmod(evidenceFile, 0o644);
      expect(await runReleaseDiagnostics(config, options)).toBe(1);
      await fs.chmod(evidenceFile, 0o600);
      const alias = `${evidenceFile}.symlink`;
      await fs.symlink(evidenceFile, alias);
      expect(await runReleaseDiagnostics(config, { ...options, evidenceFile: alias })).toBe(1);
      await fs.link(evidenceFile, `${evidenceFile}.hardlink`);
      expect(await runReleaseDiagnostics(config, options)).toBe(1);
      expect(inspectDiagnosticJournal(file).reservations).toHaveLength(2);
    } finally { log.mockRestore(); }
  });
});
