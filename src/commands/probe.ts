import { EapiClient } from "../eapi/client.js";
import { loadInventoryModel } from "../inventory/loadInventory.js";
import { probeDevices } from "../probe/probeDevices.js";
import { AppError } from "../core/errors.js";
import type { ResolvedServerConfig } from "../config/schema.js";
import { prettyJson } from "../utils/json.js";

export async function runProbe(config: ResolvedServerConfig, target: string, asJson: boolean): Promise<number> {
  if (!config.inventoryPath) {
    throw new AppError("cli_missing_inventory", "probe requires an inventory path via --inventory or config file");
  }

  const model = await loadInventoryModel(config.inventoryPath);
  const result = await probeDevices(model, config, { target, include_raw: false }, new EapiClient());

  if (asJson) {
    console.log(prettyJson(result));
  } else {
    console.log(`Probe target: ${result.target}`);
    console.log(`Devices: ${result.summary.success_count}/${result.summary.total_count} succeeded`);

    for (const entry of result.results) {
      const suffix = entry.status === "success" ? "" : ` - ${entry.message ?? entry.error_code ?? "failed"}`;
      console.log(`- ${entry.inventory_hostname}: ${entry.status}${suffix}`);
    }
  }

  return result.summary.failed_count === 0 ? 0 : 1;
}
