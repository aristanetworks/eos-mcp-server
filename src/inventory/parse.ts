import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import type { InventoryValidationError } from "./types.js";

export interface ParsedInventoryDocumentResult {
  rootValue?: unknown;
  errors: InventoryValidationError[];
}

export async function parseInventoryDocument(inventoryPath: string): Promise<ParsedInventoryDocumentResult> {
  try {
    const text = await fs.readFile(inventoryPath, "utf8");
    const doc = parseDocument(text, { uniqueKeys: true, merge: true, prettyErrors: true });

    if (doc.errors.length > 0) {
      return {
        errors: doc.errors.map((error) => ({
          code: "inventory_yaml_invalid",
          message: `Invalid inventory YAML: ${error.message}`
        }))
      };
    }

    return {
      rootValue: doc.toJS(),
      errors: []
    };
  } catch (error) {
    return {
      errors: [
        {
          code: "inventory_validation_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  }
}
