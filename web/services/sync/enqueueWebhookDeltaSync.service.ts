import { SyncRunPhase, WebhookEventStatus } from "@prisma/client";
import { createDeltaSyncRun } from "../../repositories/deltaSyncRun.repository";
import {
  createWebhookEventLedgerEntry,
  findWebhookEventByShopTopicHash,
  updateWebhookEventStatus,
} from "../../repositories/webhookEventLedger.repository";
import { resolveDeltaPhaseFromWebhook, DeltaSyncPhase } from "./deltaPhaseRegistry";
import { enqueueDeltaSyncJob } from "../../Jobs/Workers/deltaSync.worker";

export interface EnqueueWebhookDeltaSyncInput {
  shopId: string;
  topic: string;
  payloadHash: string;
  resourceGid: string | null;
  webhookId?: string | null;
  apiVersion?: string | null;
  rawHeadersJson?: unknown;
  rawBodyJson?: unknown;
}

export async function enqueueWebhookDeltaSync(
  input: EnqueueWebhookDeltaSyncInput,
): Promise<void> {
  const existing = await findWebhookEventByShopTopicHash({
    shopId: input.shopId,
    topic: input.topic,
    payloadHash: input.payloadHash,
  });

  if (existing) {
    await updateWebhookEventStatus({
      webhookEventId: existing.id,
      status: WebhookEventStatus.DEDUPED,
    });
    return;
  }

  const webhookEvent = await createWebhookEventLedgerEntry({
    shopId: input.shopId,
    topic: input.topic,
    webhookId: input.webhookId,
    apiVersion: input.apiVersion,
    payloadHash: input.payloadHash,
    resourceGid: input.resourceGid,
    rawHeadersJson: input.rawHeadersJson,
    rawBodyJson: input.rawBodyJson,
  });

  const delta = resolveDeltaPhaseFromWebhook({
    topic: input.topic,
    resourceGid: input.resourceGid,
  });

  if (!delta) {
    await updateWebhookEventStatus({
      webhookEventId: webhookEvent.id,
      status: WebhookEventStatus.PROCESSED,
    });
    return;
  }

  const syncRun = await createDeltaSyncRun({
    shopId: input.shopId,
    phase: mapDeltaPhaseToSyncRunPhase(delta.phase),
  });

  await updateWebhookEventStatus({
    webhookEventId: webhookEvent.id,
    status: WebhookEventStatus.ENQUEUED,
  });

  await enqueueDeltaSyncJob({
    shopId: input.shopId,
    syncRunId: syncRun.id,
    phase: delta.phase,
    resourceGid: delta.resourceGid,
    webhookEventId: webhookEvent.id,
  });
}

function mapDeltaPhaseToSyncRunPhase(phase: DeltaSyncPhase): SyncRunPhase {
  switch (phase) {
    case DeltaSyncPhase.REFRESH_PRODUCT:
      return SyncRunPhase.REFRESH_PRODUCT;
    case DeltaSyncPhase.REFRESH_VARIANT:
      return SyncRunPhase.REFRESH_VARIANT;
    case DeltaSyncPhase.REFRESH_INVENTORY_ITEM:
      return SyncRunPhase.REFRESH_INVENTORY_ITEM;
    case DeltaSyncPhase.REFRESH_COLLECTION_MEMBERSHIP:
      return SyncRunPhase.REFRESH_COLLECTION_MEMBERSHIP;
    default:
      throw new Error(`Unsupported delta phase to sync_run mapping: ${phase}`);
  }
}