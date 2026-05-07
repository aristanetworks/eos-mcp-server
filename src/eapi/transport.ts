import fs from "node:fs/promises";
import https from "node:https";
import { AppError } from "../core/errors.js";
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
      let settled = false;
      let abortListenerAttached = false;
      const cleanupAbortListener = (): void => {
        if (abortListenerAttached) {
          signal.removeEventListener("abort", abortRequest);
          abortListenerAttached = false;
        }
      };
      const rejectOnce = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupAbortListener();
        reject(error);
      };
      const resolveOnce = (response: EapiHttpResponse): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupAbortListener();
        resolve(response);
      };
      const abortRequest = (): void => {
        request.destroy(buildAbortError(signal.reason, connection));
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
          let responseSizeBytes = 0;
          response.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            responseSizeBytes += buffer.length;

            if (
              connection.maxResponseSizeBytes !== undefined &&
              responseSizeBytes > connection.maxResponseSizeBytes
            ) {
              const error = new AppError(
                "response_size_exceeded",
                `EOS eAPI HTTP response size exceeded maxResponseSizeBytes ${connection.maxResponseSizeBytes}`,
                {
                  responseSizeBytes,
                  maxResponseSizeBytes: connection.maxResponseSizeBytes,
                  inventoryHostname: connection.inventoryHostname
                }
              );
              rejectOnce(error);
              request.destroy(error);
              return;
            }

            chunks.push(buffer);
          });
          response.on("end", () => {
            if (settled) {
              return;
            }
            const text = Buffer.concat(chunks).toString("utf8");
            resolveOnce({
              ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode ?? 0,
              json: async () => JSON.parse(text),
              text: async () => text
            });
          });
        }
      );

      request.on("error", (error) => {
        rejectOnce(error);
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

function buildAbortError(reason: unknown, connection: EapiConnectionConfig): Error {
  if (reason instanceof AppError) {
    return reason;
  }

  if (reason instanceof DOMException && reason.name === "TimeoutError") {
    return new AppError(
      "eapi_request_timeout",
      `EOS eAPI request for host ${connection.inventoryHostname} exceeded timeoutMs ${connection.timeoutMs}`,
      {
        inventoryHostname: connection.inventoryHostname,
        timeoutMs: connection.timeoutMs
      }
    );
  }

  return new AppError("eapi_request_aborted", `EOS eAPI request for host ${connection.inventoryHostname} was aborted`, {
    inventoryHostname: connection.inventoryHostname
  });
}
