import { z } from "zod";

const eapiVersionSchema = z.union([z.literal(1), z.literal("latest")]);

export const serverConfigFileSchema = z
  .object({
    version: z.literal(1).optional(),
    inventory: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().optional(),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    deviceConcurrency: z.number().int().positive().optional(),
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
    inventoryPath: z.string().min(1).optional(),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().default(10_000),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    deviceConcurrency: z.number().int().positive().default(5),
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
  });

export type ServerConfigFile = z.infer<typeof serverConfigFileSchema>;
export type ResolvedServerConfig = z.infer<typeof resolvedServerConfigSchema>;
