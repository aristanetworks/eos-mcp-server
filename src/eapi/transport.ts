import fs from "node:fs/promises";
import https from "node:https";
import type { EapiConnectionConfig } from "./types.js";

export interface EapiHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface EapiTransport {
  postJson(connection: EapiConnectionConfig, requestJson: string, signal: AbortSignal): Promise<EapiHttpResponse>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<EapiHttpResponse>;

export class FetchEapiTransport implements EapiTransport {
  constructor(private readonly fetchFn: FetchLike) {}

  async postJson(connection: EapiConnectionConfig, requestJson: string, signal: AbortSignal): Promise<EapiHttpResponse> {
    return this.fetchFn(connection.baseUrl, {
      method: "POST",
      headers: {
        Authorization: buildBasicAuthHeader(connection),
        "Content-Type": "application/json"
      },
      body: requestJson,
      signal
    });
  }
}

export class NodeHttpsEapiTransport implements EapiTransport {
  private readonly caCache = new Map<string, Promise<string>>();

  async postJson(connection: EapiConnectionConfig, requestJson: string, signal: AbortSignal): Promise<EapiHttpResponse> {
    const url = new URL(connection.baseUrl);
    const ca = connection.caFile ? await this.readCaFile(connection.caFile) : undefined;

    return new Promise((resolve, reject) => {
      let abortListenerAttached = false;
      const cleanupAbortListener = (): void => {
        if (abortListenerAttached) {
          signal.removeEventListener("abort", abortRequest);
          abortListenerAttached = false;
        }
      };
      const abortRequest = (): void => {
        cleanupAbortListener();
        request.destroy(new Error("EOS eAPI request aborted"));
      };
      const request = https.request(
        url,
        {
          method: "POST",
          rejectUnauthorized: connection.validateCerts,
          ...(ca !== undefined ? { ca } : {}),
          headers: {
            Authorization: buildBasicAuthHeader(connection),
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestJson)
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            cleanupAbortListener();
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode ?? 0,
              json: async () => JSON.parse(text),
              text: async () => text
            });
          });
        }
      );

      request.on("error", (error) => {
        cleanupAbortListener();
        reject(error);
      });

      if (signal.aborted) {
        abortRequest();
        return;
      } else {
        signal.addEventListener("abort", abortRequest, { once: true });
        abortListenerAttached = true;
      }

      request.write(requestJson);
      request.end();
    });
  }

  private async readCaFile(caFile: string): Promise<string> {
    const existing = this.caCache.get(caFile);
    if (existing) {
      return existing;
    }

    const pending = fs.readFile(caFile, "utf8");
    this.caCache.set(caFile, pending);

    try {
      return await pending;
    } catch (error) {
      this.caCache.delete(caFile);
      throw error;
    }
  }
}

function buildBasicAuthHeader(connection: EapiConnectionConfig): string {
  return `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString("base64")}`;
}
