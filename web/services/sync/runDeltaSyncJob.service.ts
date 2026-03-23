import { WebhookEventStatus } from "@prisma/client";
import { completeDeltaSyncRun, failDeltaSyncRun } from "../../repositories/deltaSyncRun.repository";
import { updateWebhookEventStatus } from "../../repositories/webhookEventLedger.repository";
import { DeltaSyncPhase } from "./deltaPhaseRegistry";
import { refreshProductByGid } from "../../services/sync/targets/refreshProductByGid.service";
import { refreshVariantByGid } from "../../services/sync/targets/refreshVariantByGid.service";
import { refreshInventoryItemByGid } from "../../services/sync/targets/refreshInventoryItemByGid.service";
import { refreshCollectionMembershipByGid } from "../../services/sync/targets/refreshCollectionMembershipByGid.service";
import type { DeltaSyncJobPayload } from "../../Jobs/Workers/deltaSync.worker";


export async function runDeltaSyncJob(payload: DeltaSyncJobPayload): Promise<void> {
  try {
    const stats = await dispatchDeltaPhase(payload);

    await completeDeltaSyncRun({
      syncRunId: payload.syncRunId,
      statsJson: {
        phase: payload.phase,
        resourceGid: payload.resourceGid,
        ...stats,
      },
    });

    await updateWebhookEventStatus({
      webhookEventId: payload.webhookEventId,
      status: WebhookEventStatus.PROCESSED,
    });
  } catch (error) {
    await failDeltaSyncRun({
      syncRunId: payload.syncRunId,
      errorCode: error instanceof Error ? error.name : "ERROR",
      errorMessage: error instanceof Error ? error.message : "Unknown delta sync error",
      statsJson: {
        phase: payload.phase,
        resourceGid: payload.resourceGid,
      },
    });

    await updateWebhookEventStatus({
      webhookEventId: payload.webhookEventId,
      status: WebhookEventStatus.FAILED,
      errorMessage: error instanceof Error ? error.message : "Unknown delta sync error",
    });

    throw error;
  }
}

async function dispatchDeltaPhase(
  payload: DeltaSyncJobPayload,
): Promise<Record<string, unknown>> {
  switch (payload.phase) {
    case DeltaSyncPhase.REFRESH_PRODUCT:
      return refreshProductByGid({
        shopId: payload.shopId,
        productGid: payload.resourceGid,
      });

    case DeltaSyncPhase.REFRESH_VARIANT:
      return refreshVariantByGid({
        shopId: payload.shopId,
        variantGid: payload.resourceGid,
      });

    case DeltaSyncPhase.REFRESH_INVENTORY_ITEM:
      return refreshInventoryItemByGid({
        shopId: payload.shopId,
        inventoryItemGid: payload.resourceGid,
      });

    case DeltaSyncPhase.REFRESH_COLLECTION_MEMBERSHIP:
      return refreshCollectionMembershipByGid({
        shopId: payload.shopId,
        resourceGid: payload.resourceGid,
      });

    default:
      throw new Error(`Unsupported delta sync phase: ${payload.phase}`);
  }
}