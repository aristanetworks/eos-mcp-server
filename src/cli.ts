import { AppError } from "./core/errors.js";
import { APP_NAME, APP_VERSION } from "./core/version.js";

export type CommandName = "serve" | "validate-inventory" | "print-server-info" | "probe";

const COMMAND_NAMES = new Set<string>(["serve", "validate-inventory", "print-server-info", "probe"]);
const OPTION_NAMES = new Set<string>([
  "--help",
  "-h",
  "--version",
  "-V",
  "--config",
  "--inventory",
  "--enable-write",
  "--allow-direct-config-fallback",
  "--actor",
  "--json",
  "--inventory-only",
  "--target"
]);

const COMMAND_OPTIONS: Record<CommandName, ReadonlySet<string>> = {
  "serve": new Set([
    "--help",
    "-h",
    "--version",
    "-V",
    "--config",
    "--inventory",
    "--actor",
    "--enable-write",
    "--allow-direct-config-fallback"
  ]),
  "validate-inventory": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--inventory-only", "--json"]),
  "print-server-info": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--json"]),
  "probe": new Set(["--help", "-h", "--version", "-V", "--config", "--inventory", "--target", "--json"])
};

export interface CliOptions {
  command: CommandName;
  explicitCommand?: boolean;
  help?: boolean;
  version?: boolean;
  configPath?: string;
  inventoryPath?: string;
  enableWrite?: boolean;
  allowDirectConfigFallback?: boolean;
  actor?: string;
  json?: boolean;
  inventoryOnly?: boolean;
  target?: string;
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
      case "--enable-write":
        options.enableWrite = true;
        index += 1;
        break;
      case "--allow-direct-config-fallback":
        options.allowDirectConfigFallback = true;
        index += 1;
        break;
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

const COMMAND_HELP: Record<CommandName, string> = {
  "serve": HELP_SERVE,
  "validate-inventory": HELP_VALIDATE_INVENTORY,
  "print-server-info": HELP_PRINT_SERVER_INFO,
  "probe": HELP_PROBE
};

export function printHelp(cli: CliOptions): void {
  const helpText = cli.explicitCommand ? COMMAND_HELP[cli.command] : HELP_TOP;
  console.log(helpText);
}

export function printVersion(): void {
  console.log(VERSION_BANNER);
}
