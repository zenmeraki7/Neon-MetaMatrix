import { Prisma, SyncRunPhase } from "@prisma/client";
import { markSyncRunCompleted, markSyncRunFailed } from "../../repositories/syncRun.repository";
import { ingestProductsCoreFromBulkUrl } from "../../Jobs/Workers/ingestProductsCore.worker";
import { ingestVariantsCoreFromBulkUrl } from "../../Jobs/Workers/ingestVariantsCore.worker";
import { ingestCollectionMembershipFromBulkUrl } from "../../Jobs/Workers/ingestCollectionMembership.worker";
import { ingestInventoryLevelsFromBulkUrl } from "../../Jobs/Workers/ingestInventoryLevels.worker";
import { enqueueRollupRebuild } from "./rollupRebuild.service";
import { enqueueNextSyncPhase } from "./syncPhaseOrchestrator.service";
import type { SyncPhaseIngestJobPayload } from "../../Jobs/Workers/syncPhase.worker";

export async function handleSyncPhaseIngest(
  payload: SyncPhaseIngestJobPayload,
): Promise<void> {
  try {
    const stats = await ingestByPhase(payload);

    await markSyncRunCompleted({
      syncRunId: payload.syncRunId,
      statsJson: {
        stage: "ingest",
        phase: payload.phase,
        ...stats,
      } satisfies Prisma.InputJsonValue,
    });

    if (payload.phase === SyncRunPhase.BULK_INVENTORY_LEVELS) {
      await enqueueRollupRebuild({
        shopId: payload.shopId,
      });
      return;
    }

    await enqueueNextSyncPhase({
      shopId: payload.shopId,
      completedPhase: payload.phase,
    });
  } catch (error) {
    await markSyncRunFailed({
      syncRunId: payload.syncRunId,
      errorCode: resolveErrorCode(error),
      errorMessage: resolveErrorMessage(error),
      statsJson: {
        stage: "ingest",
        phase: payload.phase,
      },
    });

    throw error;
  }
}

async function ingestByPhase(payload: SyncPhaseIngestJobPayload): Promise<Record<string, number>> {
  switch (payload.phase) {
    case SyncRunPhase.BULK_PRODUCTS_CORE:
      return ingestProductsCoreFromBulkUrl({
        shopId: payload.shopId,
        bulkResultUrl: payload.bulkResultUrl,
      });

    case SyncRunPhase.BULK_VARIANTS_CORE:
      return ingestVariantsCoreFromBulkUrl({
        shopId: payload.shopId,
        bulkResultUrl: payload.bulkResultUrl,
      });

    case SyncRunPhase.BULK_COLLECTION_MEMBERSHIP:
      return ingestCollectionMembershipFromBulkUrl({
        shopId: payload.shopId,
        bulkResultUrl: payload.bulkResultUrl,
      });

    case SyncRunPhase.BULK_INVENTORY_LEVELS:
      return ingestInventoryLevelsFromBulkUrl({
        shopId: payload.shopId,
        bulkResultUrl: payload.bulkResultUrl,
      });

    default:
      throw new Error(`Unsupported ingest phase: ${payload.phase satisfies never}`);
  }
}

function resolveErrorCode(error: unknown): string {
  return error instanceof Error ? error.name || "ERROR" : "ERROR";
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown sync phase ingest error";
}