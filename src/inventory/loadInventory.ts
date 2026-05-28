import { AppError } from "../core/errors.js";
import { buildInventoryModel } from "./buildModel.js";
import type { ValidationContext } from "./internalTypes.js";
import { detectSchemaKind, normalizeInventory } from "./normalize.js";
import { parseInventoryDocument } from "./parse.js";
import type {
  InventoryModel,
  InventorySchemaKind,
  InventorySummary,
  InventoryValidationError,
  InventoryValidationResult
} from "./types.js";
import { validateNormalizedInventory } from "./validateNormalized.js";
import { validateKnownInventoryVarTypes } from "./varValidation.js";

interface ParsedInventoryResult {
  schemaKind?: InventorySchemaKind;
  summary?: InventorySummary;
  model?: InventoryModel;
  errors: InventoryValidationError[];
  notes: string[];
}

function buildParsedInventoryResult(result: Omit<ParsedInventoryResult, "notes"> & { notes?: string[] }): ParsedInventoryResult {
  return {
    ...result,
    notes: result.notes ?? []
  };
}

function assertParsedInventorySuccess<TValue>(
  result: ParsedInventoryResult,
  value: TValue | undefined
): TValue {
  if (result.errors.length > 0 || value === undefined) {
    throw new AppError(
      "inventory_validation_failed",
      result.errors.map((error) => error.message).join("; ")
    );
  }

  return value;
}

export async function loadInventorySummary(inventoryPath: string): Promise<InventorySummary> {
  const result = await parseAndValidateInventory(inventoryPath);
  return assertParsedInventorySuccess(result, result.summary);
}

export async function loadInventoryModel(inventoryPath: string): Promise<InventoryModel> {
  const result = await parseAndValidateInventory(inventoryPath);
  return assertParsedInventorySuccess(result, result.model);
}

export async function validateInventory(inventoryPath: string): Promise<InventoryValidationResult> {
  const result = await parseAndValidateInventory(inventoryPath);

  return {
    ok: result.errors.length === 0,
    ...(result.schemaKind !== undefined ? { schemaKind: result.schemaKind } : {}),
    ...(result.summary !== undefined ? { summary: result.summary } : {}),
    errors: result.errors,
    notes: result.notes
  };
}

async function parseAndValidateInventory(inventoryPath: string): Promise<ParsedInventoryResult> {
  const parsedDocument = await parseInventoryDocument(inventoryPath);
  if (parsedDocument.errors.length > 0 || parsedDocument.rootValue === undefined) {
    return buildParsedInventoryResult({
      errors: parsedDocument.errors
    });
  }

  try {
    const schemaKind = detectSchemaKind(parsedDocument.rootValue);
    const context: ValidationContext = { errors: [] };
    const normalized = normalizeInventory(parsedDocument.rootValue, schemaKind, context);

    if (!normalized) {
      return buildParsedInventoryResult({
        schemaKind,
        errors: context.errors
      });
    }

    validateNormalizedInventory(normalized, context);
    validateKnownInventoryVarTypes(normalized, context);

    if (context.errors.length > 0) {
      return buildParsedInventoryResult({
        schemaKind,
        errors: context.errors
      });
    }

    const model = buildInventoryModel(normalized, inventoryPath, context);
    if (!model || context.errors.length > 0) {
      return buildParsedInventoryResult({
        schemaKind,
        errors: context.errors
      });
    }

    return buildParsedInventoryResult({
      schemaKind,
      summary: model.summary,
      model,
      errors: context.errors
    });
  } catch (error) {
    return buildParsedInventoryResult({
      errors: [
        {
          code: "inventory_validation_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    });
  }
}
