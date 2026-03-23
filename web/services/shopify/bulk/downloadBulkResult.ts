import { Readable } from "node:stream";

export interface DownloadBulkResultInput {
  url: string;
  timeoutMs?: number;
  expectedContentTypeIncludes?: string[];
}

export class BulkResultDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkResultDownloadError";
    Object.setPrototypeOf(this, BulkResultDownloadError.prototype);
  }
}

export async function downloadBulkResult(
  input: DownloadBulkResultInput,
): Promise<Readable> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new BulkResultDownloadError(
        `Bulk result download failed with HTTP ${response.status}`,
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      input.expectedContentTypeIncludes?.length &&
      !input.expectedContentTypeIncludes.some((token) =>
        contentType.includes(token.toLowerCase()),
      )
    ) {
      throw new BulkResultDownloadError(
        `Unexpected bulk result content-type "${contentType}"`,
      );
    }

    if (!response.body) {
      throw new BulkResultDownloadError("Bulk result response body was empty");
    }

    return Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BulkResultDownloadError(
        `Bulk result download timed out after ${timeoutMs}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}