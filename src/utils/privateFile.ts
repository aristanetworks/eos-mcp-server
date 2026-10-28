import type { Stats } from "node:fs";

/** Shared file policy; callers retain path/descriptor race checks and error codes. */
export function isPrivateRegularFile(stat: Stats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    (process.platform === "win32" || ((stat.mode & 0o077) === 0 &&
      (process.getuid === undefined || stat.uid === process.getuid())));
}
