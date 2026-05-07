#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { AppError, toErrorMessage } from "./core/errors.js";
import { parseCliArgs, printHelp, printVersion } from "./cli.js";
import { runProbe } from "./commands/probe.js";
import { runValidateInventory } from "./commands/validateInventory.js";
import { printServerInfo } from "./commands/printServerInfo.js";
import { loadServerConfig } from "./config/loadConfig.js";
import { validateStartupConnections } from "./connection/validateStartupConnections.js";
import { loadInventoryModel } from "./inventory/loadInventory.js";
import { startMcpServer } from "./mcp/createServer.js";
import type { ServerRuntimeContext } from "./serverInfo/types.js";

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.version) {
    printVersion();
    return;
  }

  if (cli.help) {
    printHelp(cli);
    return;
  }

  const config = await loadServerConfig(cli);

  switch (cli.command) {
    case "validate-inventory": {
      const exitCode = await runValidateInventory(config, {
        asJson: cli.json ?? false,
        inventoryOnly: cli.inventoryOnly ?? false
      });
      process.exitCode = exitCode;
      return;
    }

    case "print-server-info": {
      const inventoryModel = config.inventoryPath ? await loadInventoryModel(config.inventoryPath) : undefined;
      const runtimeContext: ServerRuntimeContext = {
        instanceId: randomUUID(),
        startedAt: new Date().toISOString(),
        config,
        ...(inventoryModel !== undefined ? { inventorySummary: inventoryModel.summary } : {}),
        writePathStatus: "idle"
      };
      printServerInfo(runtimeContext, cli.json ?? false);
      return;
    }

    case "probe": {
      if (!cli.target) {
        throw new AppError("cli_missing_target", "probe requires a target via --target");
      }

      const exitCode = await runProbe(config, cli.target, cli.json ?? false);
      process.exitCode = exitCode;
      return;
    }

    case "serve": {
      if (!config.inventoryPath) {
        throw new AppError("cli_missing_inventory", "serve requires an inventory path via --inventory or config file");
      }
      const inventoryModel = await loadInventoryModel(config.inventoryPath);
      validateStartupConnections(config, inventoryModel);
      await startMcpServer(config, inventoryModel);
      return;
    }
  }
}

main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exitCode = 1;
});
