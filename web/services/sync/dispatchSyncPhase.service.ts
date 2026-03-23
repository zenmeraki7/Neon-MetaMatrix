import { Prisma } from "@prisma/client";
import { ShopifyAdminGraphqlClient } from "../shopify/adminGraphql.client";
import { runBulkQuery } from "../shopify/bulk/runBulkQuery";
import { findShopSyncCredentials } from "../../repositories/shop.repository";
import {
  findSyncRunById,
  markSyncRunBulkStarted,
  markSyncRunFailed,
} from "../../repositories/syncRun.repository";
import { buildBulkQueryForPhase } from "./syncPhaseQueries";
import {
  enqueueSyncPhaseIngest,
  type SyncPhaseDispatchJobPayload,
} from "../../Jobs/Workers/syncPhase.worker";

export async function dispatchSyncPhase(
  payload: SyncPhaseDispatchJobPayload,
): Promise<void> {
  const syncRun = await findSyncRunById(payload.syncRunId);
  if (!syncRun) {
    throw new Error(`SyncRun not found: ${payload.syncRunId}`);
  }

  const shop = await findShopSyncCredentials(payload.shopId);
  if (!shop) {
    throw new Error(`Shop not found: ${payload.shopId}`);
  }

  try {
    const client = new ShopifyAdminGraphqlClient({
      shopDomain: shop.shopDomain,
      accessToken: shop.accessToken,
      apiVersion: shop.apiVersion,
    });

    const query = buildBulkQueryForPhase(payload.phase);

    const result = await runBulkQuery({
      client,
      query,
      pollIntervalMs: payload.pollIntervalMs,
      timeoutMs: payload.timeoutMs,
    });

    await markSyncRunBulkStarted({
      syncRunId: payload.syncRunId,
      bulkOperationGid: result.bulkOperation.id,
      bulkOperationStatus: result.bulkOperation.status,
      bulkResultUrl: result.bulkOperation.url,
      objectCount: parseOptionalBigInt(result.bulkOperation.objectCount),
      fileSizeBytes: parseOptionalBigInt(result.bulkOperation.fileSize),
      statsJson: buildBulkStats(result.bulkOperation),
    });

    if (!result.bulkOperation.url) {
      throw new Error(
        `Bulk phase ${payload.phase} completed without a result URL for syncRun ${payload.syncRunId}`,
      );
    }

    await enqueueSyncPhaseIngest({
      shopId: payload.shopId,
      syncRunId: payload.syncRunId,
      phase: payload.phase,
      bulkResultUrl: result.bulkOperation.url,
    });
  } catch (error) {
    await markSyncRunFailed({
      syncRunId: payload.syncRunId,
      errorCode: resolveErrorCode(error),
      errorMessage: resolveErrorMessage(error),
      statsJson: {
        stage: "dispatch",
        phase: payload.phase,
      },
    });

    throw error;
  }
}

function buildBulkStats(snapshot: {
  id: string;
  status: string;
  errorCode: string | null;
  objectCount: string | null;
  fileSize: string | null;
  url: string | null;
  partialDataUrl: string | null;
  createdAt: string | null;
  completedAt: string | null;
}): Prisma.InputJsonValue {
  return {
    bulkOperationId: snapshot.id,
    bulkOperationStatus: snapshot.status,
    bulkOperationErrorCode: snapshot.errorCode,
    objectCount: snapshot.objectCount,
    fileSize: snapshot.fileSize,
    resultUrl: snapshot.url,
    partialDataUrl: snapshot.partialDataUrl,
    createdAt: snapshot.createdAt,
    completedAt: snapshot.completedAt,
  };
}

function parseOptionalBigInt(value: string | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function resolveErrorCode(error: unknown): string {
  return error instanceof Error ? error.name || "ERROR" : "ERROR";
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown sync phase dispatch error";
}