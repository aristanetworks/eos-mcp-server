export type EapiOutputFormat = "json" | "text";

export interface EapiConnectionConfig {
  inventoryHostname: string;
  endpointHost: string;
  baseUrl: string;
  username: string;
  password: string;
  validateCerts: boolean;
  caFile?: string;
  timeoutMs: number;
}

export interface EapiJsonRpcRequest {
  jsonrpc: "2.0";
  method: "runCmds";
  params: {
    version: 1;
    cmds: string[];
    format: EapiOutputFormat;
  };
  id: string;
}
