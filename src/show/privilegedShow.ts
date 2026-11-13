/**
 * Privileged Show Commands (ADR 0011): the only show commands `eos_run_show` may run in EOS
 * privileged mode. The server, never the caller, decides this. Adding an entry is a code change
 * that needs evidence the command cannot change device state or write files, or that the server
 * blocks whatever does. Operators may narrow this list through `privilegedShowCommands` but never
 * extend it.
 */
export const PRIVILEGED_SHOW_COMMANDS = ["show event-monitor"] as const;

export type PrivilegedShowCommand = (typeof PRIVILEGED_SHOW_COMMANDS)[number];

/** True when the command's leading words equal one allowed entry's words exactly (case-insensitive).
 * Abbreviations such as `sh ev` never match, so they run unprivileged and fail on the device.
 */
export function isPrivilegedShowCommand(command: string, allowedCommands: readonly PrivilegedShowCommand[]): boolean {
  const normalizedCommand = command.trim().toLowerCase().replace(/\s+/g, " ");
  // Entries are lowercase with single spaces, so a string prefix plus a word boundary is a whole-word match.
  return allowedCommands.some((allowedCommand) => normalizedCommand === allowedCommand || normalizedCommand.startsWith(`${allowedCommand} `));
}
