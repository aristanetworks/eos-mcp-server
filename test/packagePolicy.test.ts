import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageJson {
  version?: string;
  scripts?: Record<string, string>;
}

interface PackageLockJson {
  version?: string;
  packages?: {
    ""?: {
      version?: string;
    };
  };
}

async function readPackageJson(): Promise<PackageJson> {
  const raw = await fs.readFile(new URL("../package.json", import.meta.url), "utf8");
  return JSON.parse(raw) as PackageJson;
}

async function readPackageLockJson(): Promise<PackageLockJson> {
  const raw = await fs.readFile(new URL("../package-lock.json", import.meta.url), "utf8");
  return JSON.parse(raw) as PackageLockJson;
}

describe("package policy", () => {
  it("builds before npm pack for reproducible packages", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts?.prepack).toBe("npm run build");
  });

  it("exposes a static policy lint command", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts?.lint).toBe("node scripts/static-policy.mjs");
    expect(packageJson.scripts?.["static-policy"]).toBe("node scripts/static-policy.mjs");
  });

  it("keeps package-lock root versions aligned with package.json", async () => {
    const packageJson = await readPackageJson();
    const packageLockJson = await readPackageLockJson();

    expect(packageLockJson.version).toBe(packageJson.version);
    expect(packageLockJson.packages?.[""]?.version).toBe(packageJson.version);
  });
});
