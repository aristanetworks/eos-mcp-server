import path from "node:path";
import { APP_NAME, APP_VERSION } from "../core/version.js";
import type { ServerInfo, ServerRuntimeContext } from "./types.js";

export function buildServerInfo(context: ServerRuntimeContext): ServerInfo {
  const summary = context.inventorySummary;

  return {
    server_name: APP_NAME,
    server_version: APP_VERSION,
    instance_id: context.instanceId,
    started_at: context.startedAt,
    runtime_mode: context.config.enableWrite ? "write-enabled" : "read-only",
    write_path_status: context.writePathStatus,
    inventory: {
      basename: summary?.basename ?? sanitizeBasename(context.config.inventoryPath),
      schema_kind: summary?.schemaKind ?? null,
      total_hosts: summary?.totalHostCount ?? null,
      total_groups: summary?.totalGroupCount ?? null,
      eos_eligible_hosts: summary?.eosEligibleHostCount ?? null,
      read_allowed_hosts: summary?.readAllowedHostCount ?? null,
      write_allowed_hosts: summary?.writeAllowedHostCount ?? null
    },
    capabilities: {
      write_enabled: context.config.enableWrite,
      direct_config_fallback_enabled: context.config.allowDirectConfigFallback,
      tool_prefix: "eos_",
      supported_inventory_schemas: ["canonical-ansible-yaml", "simplified-yaml"],
      output_modes: ["auto", "json", "text"]
    },
    limits: {
      read_timeout_ms: context.config.readTimeoutMs,
      write_timeout_ms: context.config.writeTimeoutMs,
      overall_operation_timeout_ms: context.config.overallOperationTimeoutMs ?? null,
      device_concurrency: context.config.deviceConcurrency,
      max_read_targets: context.config.maxReadTargets,
      max_write_targets: context.config.maxWriteTargets,
      max_show_commands_per_request: context.config.maxShowCommandsPerRequest,
      max_config_commands_per_request: context.config.maxConfigCommandsPerRequest,
      max_response_size_bytes: context.config.maxResponseSizeBytes,
      preview_max_age_ms: context.config.previewMaxAgeMs
    },
    logging: {
      actor: context.config.actor ?? null,
      log_file_configured: context.config.logFile !== undefined,
      log_write_commands: context.config.logWriteCommands
    },
    tls: {
      custom_ca_configured: context.config.caFile !== undefined
    }
  };
}

function sanitizeBasename(filePath: string | undefined): string | null {
  if (!filePath) {
    return null;
  }

  return path.basename(filePath);
}
