import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageJson {
  version?: string;
  scripts?: Record<string, string>;
  files?: string[];
  repository?: {
    type?: string;
    url?: string;
  };
  bugs?: {
    url?: string;
  };
  homepage?: string;
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

  it("ships release docs and examples in npm packages", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.files).toEqual(expect.arrayContaining(["dist", "docs", "example-inventories", "CHANGELOG.md"]));
  });

  it("exposes repository metadata for package consumers", async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.repository?.type).toBe("git");
    expect(packageJson.repository?.url).toContain("github.com/aristanetworks/eos-mcp-server");
    expect(packageJson.bugs?.url).toContain("github.com/aristanetworks/eos-mcp-server/issues");
    expect(packageJson.homepage).toContain("github.com/aristanetworks/eos-mcp-server");
  });

  it("keeps package-lock root versions aligned with package.json", async () => {
    const packageJson = await readPackageJson();
    const packageLockJson = await readPackageLockJson();

    expect(packageLockJson.version).toBe(packageJson.version);
    expect(packageLockJson.packages?.[""]?.version).toBe(packageJson.version);
  });
});
