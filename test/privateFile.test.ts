import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPrivateRegularFile } from "../src/utils/privateFile.js";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "eos-private-file-"));
  file = path.join(directory, "private.json");
  await fs.writeFile(file, "{}", { mode: 0o600 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("private regular-file policy", () => {
  it("accepts an owner-controlled regular file with one link", async () => {
    expect(isPrivateRegularFile(await fs.lstat(file))).toBe(true);
  });

  it("rejects directories", async () => {
    expect(isPrivateRegularFile(await fs.lstat(directory))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("rejects symlinks rather than trusting their private referent", async () => {
    const alias = path.join(directory, "symlink");
    await fs.symlink(file, alias);
    expect(isPrivateRegularFile(await fs.lstat(alias))).toBe(false);
  });

  it("rejects every hard-link alias", async () => {
    const alias = path.join(directory, "hardlink");
    await fs.link(file, alias);
    expect(isPrivateRegularFile(await fs.lstat(file))).toBe(false);
    expect(isPrivateRegularFile(await fs.lstat(alias))).toBe(false);
  });

  it.skipIf(process.platform === "win32").each([
    { mode: 0o600, allowed: true },
    { mode: 0o400, allowed: true },
    { mode: 0o700, allowed: true },
    { mode: 0o644, allowed: false },
    { mode: 0o660, allowed: false },
    { mode: 0o601, allowed: false }
  ])("checks group/other bits, not owner access bits ($mode)", async ({ mode, allowed }) => {
    await fs.chmod(file, mode);
    expect(isPrivateRegularFile(await fs.lstat(file))).toBe(allowed);
  });

  it.skipIf(process.platform === "win32" || process.getuid === undefined)("rejects files owned by another UID", async () => {
    const stat = await fs.lstat(file);
    vi.spyOn(process, "getuid").mockReturnValue(stat.uid + 1);
    expect(isPrivateRegularFile(stat)).toBe(false);
  });
});
