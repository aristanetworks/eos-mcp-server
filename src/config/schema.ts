import { z } from "zod";

export const serverConfigFileSchema = z
  .object({
    version: z.literal(1).optional(),
    inventory: z.string().min(1).optional(),
    enableWrite: z.boolean().optional(),
    allowDirectConfigFallback: z.boolean().optional(),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().optional(),
    writeTimeoutMs: z.number().int().positive().optional(),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    deviceConcurrency: z.number().int().positive().optional(),
    maxReadTargets: z.number().int().positive().optional(),
    maxWriteTargets: z.number().int().positive().optional(),
    maxShowCommandsPerRequest: z.number().int().positive().optional(),
    maxConfigCommandsPerRequest: z.number().int().positive().optional(),
    previewMaxAgeMs: z.number().int().positive().optional(),
    logWriteCommands: z.boolean().optional(),
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
    enableWrite: z.boolean().default(false),
    allowDirectConfigFallback: z.boolean().default(false),
    actor: z.string().min(1).optional(),
    logFile: z.string().min(1).optional(),
    caFile: z.string().min(1).optional(),
    readTimeoutMs: z.number().int().positive().default(10_000),
    writeTimeoutMs: z.number().int().positive().default(30_000),
    overallOperationTimeoutMs: z.number().int().positive().optional(),
    deviceConcurrency: z.number().int().positive().default(5),
    maxReadTargets: z.number().int().positive().default(50),
    maxWriteTargets: z.number().int().positive().default(10),
    maxShowCommandsPerRequest: z.number().int().positive().default(5),
    maxConfigCommandsPerRequest: z.number().int().positive().default(20),
    previewMaxAgeMs: z.number().int().positive().default(15 * 60_000),
    logWriteCommands: z.boolean().default(false),
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
  .superRefine((value, ctx) => {
    if (value.enableWrite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enableWrite is not supported in the read-only MVP",
        path: ["enableWrite"]
      });
    }

    if (value.allowDirectConfigFallback) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "allowDirectConfigFallback is not supported in the read-only MVP",
        path: ["allowDirectConfigFallback"]
      });
    }
  });

export type ServerConfigFile = z.infer<typeof serverConfigFileSchema>;
export type ResolvedServerConfig = z.infer<typeof resolvedServerConfigSchema>;
