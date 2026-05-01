export type CommandName = "serve" | "validate-inventory" | "print-server-info" | "probe";

const COMMAND_NAMES = new Set<string>(["serve", "validate-inventory", "print-server-info", "probe"]);

export interface CliOptions {
  command: CommandName;
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
  if (first !== undefined && COMMAND_NAMES.has(first)) {
    command = first as CommandName;
    index = 1;
  }

  const options: CliOptions = { command };

  while (index < argv.length) {
    const arg = argv[index];

    switch (arg) {
      case "--config": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("Missing value for --config");
        }
        options.configPath = value;
        index += 2;
        break;
      }
      case "--inventory": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("Missing value for --inventory");
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
          throw new Error("Missing value for --actor");
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
          throw new Error("Missing value for --target");
        }
        options.target = value;
        index += 2;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}
