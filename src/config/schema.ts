import { z } from "zod";
import { diagnosticsConfigSchema } from "./diagnostics.js";

const eapiVersionSchema = z.union([z.literal(1), z.literal("latest")]);

export const serverConfigFileSchema = z
  .object({
    version: z.literal(1).optional(),
    diagnostics: diagnosticsConfigSchema.optional(),
    inventory: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().optional(),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    deviceConcurrency: z.number().int().positive().optional(),
    readFanOut: z.number().int().positive().optional(),
    maxReadTargets: z.number().int().positive().optional(),
    maxShowCommandsPerRequest: z.number().int().positive().optional(),
    maxLoggingMessagesPerRequest: z.number().int().positive().max(9999).optional(),
    maxResponseSizeBytes: z.number().int().positive().optional(),
    eapiVersion: eapiVersionSchema.optional(),
    secretEnvPrefixes: z.array(z.string().min(1)).optional(),
    defaultConnection: z
      .object({
        ansibleUser: z.string().min(1).optional(),
        ansibleHttpapiPort: z.number().int().positive().optional(),
        mcpValidateCerts: z.boolean().optional(),
        mcpPasswordEnv: z.string().min(1).optional()
      })
      .optional()
  })
  .strict();

export const resolvedServerConfigSchema = z
  .object({
    configPath: z.string().min(1).optional(),
    diagnostics: diagnosticsConfigSchema.default({}),
    inventoryPath: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().default(10_000),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    /** eAPI slots one host may hold across all calls, reads and diagnostics (ADR 0009). */
    deviceConcurrency: z.number().int().positive().default(3),
    /** Hosts one read call contacts at once. */
    readFanOut: z.number().int().positive().default(10),
    maxReadTargets: z.number().int().positive().default(50),
    maxShowCommandsPerRequest: z.number().int().positive().default(5),
    maxLoggingMessagesPerRequest: z.number().int().positive().max(9999).default(1000),
    maxResponseSizeBytes: z.number().int().positive().default(1_048_576),
    eapiVersion: eapiVersionSchema.default("latest"),
    secretEnvPrefixes: z.array(z.string().min(1)).default(["EOS_MCP_"]),
    defaultConnection: z
      .object({
        ansibleUser: z.string().min(1).optional(),
        ansibleHttpapiPort: z.number().int().positive().optional(),
        mcpValidateCerts: z.boolean().optional(),
        mcpPasswordEnv: z.string().min(1).optional()
      })
      .default({})
  })
  .superRefine((config, context) => {
    if (config.diagnostics.deviceConcurrency > config.deviceConcurrency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["diagnostics", "deviceConcurrency"],
        message: "Must not exceed the top-level deviceConcurrency, which covers reads and diagnostics together"
      });
    }
  });

export type ServerConfigFile = z.infer<typeof serverConfigFileSchema>;
export type ResolvedServerConfig = z.infer<typeof resolvedServerConfigSchema>;
