#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");

const bannedPatterns = [
  {
    name: "plain throw new Error",
    pattern: /\bthrow\s+new\s+Error\s*\(/,
    message: "Use AppError with a machine-readable code instead."
  },
  {
    name: "@ts-ignore",
    pattern: /@ts-ignore/,
    message: "Use type-safe code or @ts-expect-error with a specific reason."
  },
  {
    name: "eslint-disable",
    pattern: /eslint-disable/,
    message: "Avoid disabling lint rules in source."
  },
  {
    name: "as any",
    pattern: /\bas\s+any\b/,
    message: "Avoid escaping TypeScript's type system."
  }
];

async function collectTypeScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function checkFile(filePath, contents) {
  const findings = [];
  const lines = contents.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const bannedPattern of bannedPatterns) {
      if (bannedPattern.pattern.test(line)) {
        findings.push({
          filePath,
          lineNumber: index + 1,
          line,
          ...bannedPattern
        });
      }
    }
  });

  return findings;
}

const files = (await collectTypeScriptFiles(srcDir)).sort();
const findings = [];

for (const file of files) {
  const contents = await fs.readFile(file, "utf8");
  findings.push(...checkFile(file, contents));
}

if (findings.length > 0) {
  console.error("Static policy violations found:");

  for (const finding of findings) {
    const relativePath = path.relative(rootDir, finding.filePath);
    console.error(`${relativePath}:${finding.lineNumber}: ${finding.name}: ${finding.message}`);
    console.error(`  ${finding.line.trim()}`);
  }

  process.exit(1);
}

console.log(`Static policy passed for ${files.length} TypeScript source files.`);
