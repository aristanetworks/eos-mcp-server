import { AppError } from "./core/errors.js";
import { APP_NAME, APP_VERSION } from "./core/version.js";

export type CommandName = "serve" | "validate-inventory" | "print-server-info" | "probe" | "inspect-diagnostics" | "release-diagnostics";

const COMMAND_NAMES = new Set<string>(["serve", "validate-inventory", "print-server-info", "probe", "inspect-diagnostics", "release-diagnostics"]);
const OPTION_NAMES = new Set<string>([
  "--help",
  "-h",
  "--version",
  "-V",
  "--config",
  "--inventory",
  "--actor",
  "--json",
  "--inventory-only",
  "--target",
  "--reservation-id",
  "--evidence-file",
  "--confirm-fenced"
]);

const COMMAND_OPTIONS: Record<CommandName, ReadonlySet<string>> = {
  "serve": new Set([
    "--help",
    "-h",
    "--version",
    "-V",
    "--config",
    "--inventory",
    "--actor"
  ]),
  "validate-inventory": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--inventory-only", "--json"]),
  "print-server-info": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--json"]),
  "probe": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--target", "--json"]),
  "inspect-diagnostics": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--json"]),
  "release-diagnostics": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--json", "--reservation-id", "--evidence-file", "--confirm-fenced"])
};

export interface CliOptions {
  command: CommandName;
  explicitCommand?: boolean;
  help?: boolean;
  version?: boolean;
  configPath?: string;
  inventoryPath?: string;
  actor?: string;
  json?: boolean;
  inventoryOnly?: boolean;
  target?: string;
  reservationIds?: string[];
  evidenceFile?: string;
  confirmFenced?: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let command: CommandName = "serve";
  let index = 0;

  const first = argv[0];
  if (first === "--help" || first === "-h") {
    return { command, help: true };
  }
  if (first === "--version" || first === "-V") {
    return { command, version: true };
  }

  let explicitCommand = false;
  if (first !== undefined && COMMAND_NAMES.has(first)) {
    command = first as CommandName;
    explicitCommand = true;
    index = 1;
  }

  const options: CliOptions = { command, ...(explicitCommand ? { explicitCommand: true } : {}) };

  while (index < argv.length) {
    const arg = argv[index];
    if (arg !== undefined && OPTION_NAMES.has(arg)) {
      assertOptionAllowed(command, arg);
    }

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        return options;
      case "--version":
      case "-V":
        options.version = true;
        return options;
      case "--config": {
        const value = argv[index + 1];
        if (!value) {
          throw new AppError("cli_missing_value", "Missing value for --config");
        }
        options.configPath = value;
        index += 2;
        break;
      }
      case "--inventory": {
        const value = argv[index + 1];
        if (!value) {
          throw new AppError("cli_missing_value", "Missing value for --inventory");
        }
        options.inventoryPath = value;
        index += 2;
        break;
      }
      case "--actor": {
        const value = argv[index + 1];
        if (!value) {
          throw new AppError("cli_missing_value", "Missing value for --actor");
        }
        options.actor = value;
        index += 2;
        break;
      }
      case "--json":
        options.json = true;
        index += 1;
        break;
      case "--inventory-only":
        options.inventoryOnly = true;
        index += 1;
        break;
      case "--reservation-id": {
        const value = argv[index + 1];
        if (!value || value.startsWith("-")) throw new AppError("cli_missing_value", "Missing value for --reservation-id");
        if (options.reservationIds?.includes(value)) throw new AppError("cli_duplicate_option", "Duplicate reservation ID");
        (options.reservationIds ??= []).push(value);
        index += 2;
        break;
      }
      case "--evidence-file": {
        const value = argv[index + 1];
        if (!value || value.startsWith("-")) throw new AppError("cli_missing_value", "Missing value for --evidence-file");
        if (options.evidenceFile !== undefined) throw new AppError("cli_duplicate_option", "Duplicate --evidence-file");
        options.evidenceFile = value;
        index += 2;
        break;
      }
      case "--confirm-fenced":
        if (options.confirmFenced !== undefined) throw new AppError("cli_duplicate_option", "Duplicate --confirm-fenced");
        options.confirmFenced = true;
        index += 1;
        break;
      case "--target": {
        const value = argv[index + 1];
        if (!value) {
          throw new AppError("cli_missing_value", "Missing value for --target");
        }
        options.target = value;
        index += 2;
        break;
      }
      default:
        throw new AppError("cli_unknown_argument", `Unknown argument: ${arg}`);
    }
  }

  return options;
}

function assertOptionAllowed(command: CommandName, option: string): void {
  if (!COMMAND_OPTIONS[command].has(option)) {
    throw new AppError("cli_option_not_allowed", `Option ${option} is not valid for command ${command}`);
  }
}

const VERSION_BANNER = `${APP_NAME} v${APP_VERSION}`;

const HELP_TOP = `${VERSION_BANNER}
MCP server for Arista EOS eAPI (JSON-RPC over HTTPS)

Usage: ${APP_NAME} [command] [options]

Commands:
  serve                 Start the MCP server over stdio (default)
  validate-inventory    Validate an inventory file
  print-server-info     Print server runtime/config summary
  probe                 Probe device readiness for a target
  inspect-diagnostics   Inspect persisted reservations and release audit (read-only)
  release-diagnostics   Offline, audited operator-attested reservation release

Global options:
  --config <path>       Path to server config YAML file
  --inventory <path>    Path to inventory YAML file
  -h, --help            Show this help message
  -V, --version         Show version number

Run '${APP_NAME} <command> --help' for command-specific options.`;

const HELP_SERVE = `Usage: ${APP_NAME} serve [options]

Start the MCP server over stdio.

Options:
  --config <path>       Path to server config YAML file
  --inventory <path>    Path to inventory YAML file
  --actor <name>        Actor label for audit logging
  -h, --help            Show this help message`;

const HELP_VALIDATE_INVENTORY = `Usage: ${APP_NAME} validate-inventory [options]

Validate an inventory file. Performs structural parsing, effective
inventory validation, and startup-style connection checks by default.

Options:
  --config <path>       Path to server config YAML file
  --inventory <path>    Path to inventory YAML file
  --inventory-only      Skip startup connection checks
  --json                Output results as JSON
  -h, --help            Show this help message`;

const HELP_PRINT_SERVER_INFO = `Usage: ${APP_NAME} print-server-info [options]

Print a sanitized summary of server runtime configuration.

Options:
  --config <path>       Path to server config YAML file
  --inventory <path>    Path to inventory YAML file
  --json                Output as JSON
  -h, --help            Show this help message`;

const HELP_PROBE = `Usage: ${APP_NAME} probe [options]

Probe device readiness for a host or group target. Tests connectivity,
authentication, and harmless command execution.

Options:
  --config <path>       Path to server config YAML file
  --inventory <path>    Path to inventory YAML file
  --target <name>       Host or group name to probe (required)
  --json                Output as JSON
  -h, --help            Show this help message`;

const HELP_INSPECT_DIAGNOSTICS = `Usage: ${APP_NAME} inspect-diagnostics [options]

Read the diagnostic ledger without device access, ownership takeover, or reset.
Recorded state is not proof of remote completion.

Options:
  --config <path>       Settings file, including optional diagnostics.stateFile
  --inventory <path>    Inventory identity used for the default ledger path
  --json                Output persisted reservations as JSON
  -h, --help            Show this help message`;

const HELP_RELEASE_DIAGNOSTICS = `Usage: ${APP_NAME} release-diagnostics [options]

Release only explicit reservations after independently verified fencing.
Requires exclusive offline ledger ownership. No device commands or MCP reset.
The evidence is operator authority, not machine-confirmed EOS completion.

Options:
  --config <path>          Settings file selecting the existing ledger
  --inventory <path>       Expected canonical inventory identity
  --reservation-id <id>    Exact reservation to release (repeat for a batch)
  --evidence-file <path>   Private UTF-8 JSON fencing attestation (max 65536 bytes)
  --confirm-fenced        Confirm running, queued and replayable work is fenced
  --json                 Output committed release metadata or error as JSON
  -h, --help             Show this help message`;

const COMMAND_HELP: Record<CommandName, string> = {
  "serve": HELP_SERVE,
  "validate-inventory": HELP_VALIDATE_INVENTORY,
  "print-server-info": HELP_PRINT_SERVER_INFO,
  "probe": HELP_PROBE,
  "inspect-diagnostics": HELP_INSPECT_DIAGNOSTICS,
  "release-diagnostics": HELP_RELEASE_DIAGNOSTICS
};

export function printHelp(cli: CliOptions): void {
  const helpText = cli.explicitCommand ? COMMAND_HELP[cli.command] : HELP_TOP;
  console.log(helpText);
}

export function printVersion(): void {
  console.log(VERSION_BANNER);
}
