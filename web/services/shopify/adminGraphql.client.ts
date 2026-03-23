import { setTimeout as sleep } from "node:timers/promises";

export interface ShopifyAdminGraphqlClientConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ShopifyGraphQLError {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface ShopifyGraphqlResponse<TData> {
  data?: TData;
  errors?: ShopifyGraphQLError[];
  extensions?: Record<string, unknown>;
}

export class ShopifyAdminGraphqlError extends Error {
  public readonly status: number;
  public readonly requestId?: string;
  public readonly body?: unknown;

  constructor(message: string, status: number, requestId?: string, body?: unknown) {
    super(message);
    this.name = "ShopifyAdminGraphqlError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
    Object.setPrototypeOf(this, ShopifyAdminGraphqlError.prototype);
  }
}

export class ShopifyAdminGraphqlClient {
  private readonly endpoint: string;
  private readonly accessToken: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: ShopifyAdminGraphqlClientConfig) {
    const apiVersion = config.apiVersion ?? process.env.SHOPIFY_ADMIN_API_VERSION ?? "2026-01";
    this.endpoint = `https://${config.shopDomain}/admin/api/${apiVersion}/graphql.json`;
    this.accessToken = config.accessToken;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 4;
  }

  async request<TData, TVariables extends Record<string, unknown> | undefined = undefined>(
    query: string,
    variables?: TVariables,
  ): Promise<TData> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": this.accessToken,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });

        const requestId = response.headers.get("x-request-id") ?? undefined;
        const body = (await response.json()) as ShopifyGraphqlResponse<TData>;

        if (!response.ok) {
          if (this.isRetryableHttpStatus(response.status) && attempt < this.maxRetries) {
            await sleep(this.computeBackoffMs(attempt, response.headers.get("retry-after")));
            continue;
          }

          throw new ShopifyAdminGraphqlError(
            `Shopify GraphQL HTTP error ${response.status}`,
            response.status,
            requestId,
            body,
          );
        }

        if (body.errors?.length) {
          throw new ShopifyAdminGraphqlError(
            `Shopify GraphQL returned top-level errors: ${body.errors.map((e) => e.message).join("; ")}`,
            response.status,
            requestId,
            body,
          );
        }

        if (!body.data) {
          throw new ShopifyAdminGraphqlError(
            "Shopify GraphQL response contained no data",
            response.status,
            requestId,
            body,
          );
        }

        return body.data;
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt >= this.maxRetries;
        const retryable =
          error instanceof ShopifyAdminGraphqlError
            ? this.isRetryableHttpStatus(error.status)
            : this.isRetryableUnknownError(error);

        if (isLastAttempt || !retryable) {
          throw error;
        }

        await sleep(this.computeBackoffMs(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown Shopify GraphQL error");
  }

  private isRetryableHttpStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 423 || status === 425 || status === 429 || status >= 500;
  }

  private isRetryableUnknownError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }

    return error instanceof TypeError;
  }

  private computeBackoffMs(attempt: number, retryAfterHeader?: string | null): number {
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    const base = 400;
    const max = 8_000;
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(max, base * 2 ** attempt) + jitter;
  }
}