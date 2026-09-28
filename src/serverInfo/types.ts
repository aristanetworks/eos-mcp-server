import type { ResolvedServerConfig } from "../config/schema.js";
import type { EapiVersion } from "../eapi/types.js";
import type { InventorySummary } from "../inventory/types.js";

export interface ServerRuntimeContext {
  instanceId: string;
  startedAt: string;
  config: ResolvedServerConfig;
  inventorySummary?: InventorySummary;
}

export interface ServerInfo {
  server_name: string;
  server_version: string;
  instance_id: string;
  started_at: string;
  runtime_mode: "read-only";
  inventory: {
    basename: string | null;
    schema_kind: string | null;
    total_hosts: number | null;
    total_groups: number | null;
    eos_eligible_hosts: number | null;
    read_allowed_hosts: number | null;
  };
  capabilities: {
    tool_prefix: "eos_";
    supported_inventory_schemas: string[];
    output_modes: Array<"auto" | "json" | "text">;
    eapi_version: EapiVersion;
  };
  limits: {
    read_timeout_ms: number;
    overall_operation_timeout_ms: number | null;
    device_concurrency: number;
    max_read_targets: number;
    max_show_commands_per_request: number;
    max_logging_messages_per_request: number;
    max_response_size_bytes: number;
  };
  logging: {
    actor: string | null;
    log_file_configured: boolean;
  };
  tls: {
    custom_ca_configured: boolean;
  };
}
