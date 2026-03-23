import readline from "node:readline";
import type { Readable } from "node:stream";

export interface JsonlStreamOptions {
  maxLineBytes?: number;
  skipEmptyLines?: boolean;
}

export class JsonlParseError extends Error {
  public readonly lineNumber: number;
  public readonly rawLine: string;

  constructor(message: string, lineNumber: number, rawLine: string) {
    super(message);
    this.name = "JsonlParseError";
    this.lineNumber = lineNumber;
    this.rawLine = rawLine;
    Object.setPrototypeOf(this, JsonlParseError.prototype);
  }
}

export async function* streamJsonl<T>(
  input: Readable,
  options?: JsonlStreamOptions,
): AsyncGenerator<T, void, undefined> {
  const skipEmptyLines = options?.skipEmptyLines ?? true;
  const maxLineBytes = options?.maxLineBytes ?? 5 * 1024 * 1024;

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  try {
    for await (const rawLine of rl) {
      lineNumber += 1;

      if (skipEmptyLines && rawLine.trim() === "") {
        continue;
      }

      if (Buffer.byteLength(rawLine, "utf8") > maxLineBytes) {
        throw new JsonlParseError(
          `JSONL line exceeded max size of ${maxLineBytes} bytes`,
          lineNumber,
          rawLine.slice(0, 500),
        );
      }

      try {
        yield JSON.parse(rawLine) as T;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown JSON parse error";

        throw new JsonlParseError(
          `Failed to parse JSONL line: ${message}`,
          lineNumber,
          rawLine.slice(0, 2_000),
        );
      }
    }
  } finally {
    rl.close();
  }
}