import { PrismaClient, WebhookEventLedger, WebhookEventStatus } from "@prisma/client";

const prisma = new PrismaClient();

export interface CreateWebhookEventInput {
  shopId: string;
  topic: string;
  webhookId?: string | null;
  apiVersion?: string | null;
  payloadHash: string;
  resourceGid?: string | null;
  rawHeadersJson?: unknown;
  rawBodyJson?: unknown;
}

export async function createWebhookEventLedgerEntry(
  input: CreateWebhookEventInput,
): Promise<WebhookEventLedger> {
  return prisma.webhookEventLedger.create({
    data: {
      shopId: input.shopId,
      topic: input.topic,
      webhookId: input.webhookId ?? null,
      apiVersion: input.apiVersion ?? null,
      payloadHash: input.payloadHash,
      resourceGid: input.resourceGid ?? null,
      rawHeadersJson: (input.rawHeadersJson as object | null) ?? null,
      rawBodyJson: (input.rawBodyJson as object | null) ?? null,
      status: WebhookEventStatus.RECEIVED,
    },
  });
}

export async function findWebhookEventByShopTopicHash(input: {
  shopId: string;
  topic: string;
  payloadHash: string;
}): Promise<WebhookEventLedger | null> {
  return prisma.webhookEventLedger.findUnique({
    where: {
      shop_id_topic_payload_hash: {
        shopId: input.shopId,
        topic: input.topic,
        payloadHash: input.payloadHash,
      },
    },
  });
}

export async function updateWebhookEventStatus(input: {
  webhookEventId: string;
  status: WebhookEventStatus;
  errorMessage?: string | null;
}): Promise<WebhookEventLedger> {
  return prisma.webhookEventLedger.update({
    where: { id: input.webhookEventId },
    data: {
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      processedAt:
        input.status === WebhookEventStatus.PROCESSED ||
        input.status === WebhookEventStatus.FAILED
          ? new Date()
          : null,
    },
  });
}