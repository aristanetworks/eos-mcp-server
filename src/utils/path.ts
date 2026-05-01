import path from "node:path";

export function resolvePathFromConfig(configPath: string, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(path.dirname(configPath), value);
}

export function resolvePathFromCwd(value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(process.cwd(), value);
}
