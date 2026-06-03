import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface PackageJson {
  name: string;
  version: string;
}

interface NpmPackEntry {
  filename?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installedBinName = process.platform === "win32" ? "eos-mcp-server.cmd" : "eos-mcp-server";

function runCommand(command: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_audit: "false",
          npm_config_fund: "false",
          npm_config_update_notifier: "false",
          NO_UPDATE_NOTIFIER: "1"
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} ${args.join(" ")} failed: ${error.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

function parseNpmPackOutput(stdout: string): NpmPackEntry[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`npm pack did not return JSON output:\n${stdout}`);
  }

  return JSON.parse(stdout.slice(start, end + 1)) as NpmPackEntry[];
}

async function readPackageJson(): Promise<PackageJson> {
  const raw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(raw) as PackageJson;
}

async function npmPack(): Promise<string> {
  const result = await runCommand(npmCommand, ["pack", "--json"], repoRoot, 120_000);
  const entries = parseNpmPackOutput(result.stdout);
  const filename = entries[0]?.filename;

  if (!filename) {
    throw new Error(`npm pack did not report a tarball filename:\n${result.stdout}`);
  }

  return path.join(repoRoot, filename);
}

async function installPackage(tarballPath: string, projectDir: string): Promise<void> {
  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({ private: true }, null, 2));
  await runCommand(
    npmCommand,
    [
      "install",
      "--offline=false",
      "--prefer-offline=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--save=false",
      tarballPath
    ],
    projectDir,
    120_000
  );
}

describe("packaged CLI smoke test", () => {
  it(
    "runs the installed package binary for CLI and MCP stdio entrypoints",
    async () => {
      const packageJson = await readPackageJson();
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "eos-mcp-package-smoke-"));
      let tarballPath: string | undefined;

      try {
        tarballPath = await npmPack();
        await installPackage(tarballPath, projectDir);

        const binPath = path.join(projectDir, "node_modules", ".bin", installedBinName);

        const version = await runCommand(binPath, ["--version"], projectDir);
        expect(version.stdout.trim()).toBe(`${packageJson.name} v${packageJson.version}`);

        const help = await runCommand(binPath, ["--help"], projectDir);
        expect(help.stdout).toContain("Usage: eos-mcp-server [command] [options]");
        expect(help.stdout).toContain("serve                 Start the MCP server over stdio");

        const inventoryPath = path.join(projectDir, "inventory.yml");
        await fs.writeFile(
          inventoryPath,
          [
            "vars:",
            "  ansible_user: admin",
            "  ansible_password: secret",
            "hosts:",
            "  leaf1:",
            "    ansible_host: 10.0.0.11",
            "    ansible_network_os: eos"
          ].join("\n")
        );

        const client = new Client(
          { name: "eos-mcp-package-smoke-test", version: "0.1.0" },
          { capabilities: {} }
        );

        const transport = new StdioClientTransport({
          command: binPath,
          args: ["serve", "--inventory", inventoryPath],
          cwd: projectDir,
          stderr: "pipe"
        });

        let stderrOutput = "";
        transport.stderr?.on("data", (chunk) => {
          stderrOutput += chunk.toString();
        });

        try {
          await client.connect(transport);

          const tools = await client.listTools();
          expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
            "eos_get_facts",
            "eos_get_running_config",
            "eos_get_server_info",
            "eos_list_inventory",
            "eos_probe_devices",
            "eos_run_show",
            "eos_show_logging"
          ]);
        } catch (error) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}\nSTDERR:\n${stderrOutput}`);
        } finally {
          await client.close();
        }
      } finally {
        if (tarballPath) {
          await fs.rm(tarballPath, { force: true });
        }
        await fs.rm(projectDir, { force: true, recursive: true });
      }
    },
    180_000
  );
});
