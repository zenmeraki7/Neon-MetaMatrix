import { setTimeout as sleep } from "node:timers/promises";
import { ShopifyAdminGraphqlClient } from "../adminGraphql.client";

export interface BulkOperationSnapshot {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string | null;
  fileSize: string | null;
  url: string | null;
  partialDataUrl: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface RunBulkQueryInput {
  client: ShopifyAdminGraphqlClient;
  query: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface RunBulkQueryResult {
  bulkOperation: BulkOperationSnapshot;
}

interface BulkOperationRunQueryResponse {
  bulkOperationRunQuery: {
    bulkOperation: BulkOperationSnapshot | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

interface CurrentBulkOperationResponse {
  currentBulkOperation: BulkOperationSnapshot | null;
}

const BULK_OPERATION_RUN_QUERY_MUTATION = `
mutation RunBulkQuery($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation {
      id
      status
      errorCode
      objectCount
      fileSize
      url
      partialDataUrl
      createdAt
      completedAt
    }
    userErrors {
      field
      message
    }
  }
}
`;

const CURRENT_BULK_OPERATION_QUERY = `
query CurrentBulkOperation {
  currentBulkOperation(type: QUERY) {
    id
    status
    errorCode
    objectCount
    fileSize
    url
    partialDataUrl
    createdAt
    completedAt
  }
}
`;

export async function runBulkQuery(input: RunBulkQueryInput): Promise<RunBulkQueryResult> {
  const pollIntervalMs = input.pollIntervalMs ?? 2_500;
  const timeoutMs = input.timeoutMs ?? 1000 * 60 * 20;

  const started = Date.now();

  const startedOperation = await startBulkOperation(input.client, input.query);

  if (!startedOperation?.id) {
    throw new Error("Shopify did not return a bulk operation id");
  }

  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Bulk operation ${startedOperation.id} timed out after ${timeoutMs}ms`);
    }

    const snapshot = await getCurrentBulkOperation(input.client);

    if (!snapshot) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (snapshot.id !== startedOperation.id) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (snapshot.status === "COMPLETED") {
      return { bulkOperation: snapshot };
    }

    if (snapshot.status === "FAILED" || snapshot.status === "CANCELED" || snapshot.status === "CANCELING") {
      throw new Error(
        `Bulk operation ${snapshot.id} ended in terminal status ${snapshot.status}${snapshot.errorCode ? ` (${snapshot.errorCode})` : ""}`,
      );
    }

    await sleep(pollIntervalMs);
  }
}

async function startBulkOperation(
  client: ShopifyAdminGraphqlClient,
  query: string,
): Promise<BulkOperationSnapshot> {
  const response = await client.request<
    BulkOperationRunQueryResponse,
    { query: string }
  >(BULK_OPERATION_RUN_QUERY_MUTATION, { query });

  const payload = response.bulkOperationRunQuery;

  if (payload.userErrors.length > 0) {
    throw new Error(
      `bulkOperationRunQuery failed: ${payload.userErrors
        .map((err) => `${err.field?.join(".") ?? "unknown"}: ${err.message}`)
        .join("; ")}`,
    );
  }

  if (!payload.bulkOperation) {
    throw new Error("bulkOperationRunQuery returned no bulkOperation");
  }

  return payload.bulkOperation;
}

async function getCurrentBulkOperation(
  client: ShopifyAdminGraphqlClient,
): Promise<BulkOperationSnapshot | null> {
  const response = await client.request<CurrentBulkOperationResponse>(CURRENT_BULK_OPERATION_QUERY);
  return response.currentBulkOperation;
}