import { PrismaClient } from "@prisma/client";
import { downloadBulkResult } from "../../services/shopify/bulk/downloadBulkResult";
import { streamJsonl } from "../../services/shopify/bulk/jsonlStream";

const prisma = new PrismaClient();
const DEFAULT_FLUSH_SIZE = 1_000;

type ProductLine = {
  __parentId?: string;
  id: string;
};

type CollectionLine = {
  __parentId: string;
  id: string;
  title?: string | null;
  ruleSet?: { appliedDisjunctively?: boolean | null } | null;
};

type MembershipRow = {
  shopId: string;
  productGid: string;
  collectionGid: string;
  collectionTitle: string | null;
  isManual: boolean;
  lastObservedAt: Date;
};

export interface IngestCollectionMembershipInput {
  shopId: string;
  bulkResultUrl: string;
  flushSize?: number;
}

export interface IngestCollectionMembershipResult {
  processedMemberships: number;
}

export async function ingestCollectionMembershipFromBulkUrl(
  input: IngestCollectionMembershipInput,
): Promise<IngestCollectionMembershipResult> {
  const stream = await downloadBulkResult({
    url: input.bulkResultUrl,
    expectedContentTypeIncludes: ["jsonl", "text/plain", "application/octet-stream"],
  });

  return ingestCollectionMembershipStream({
    shopId: input.shopId,
    stream,
    flushSize: input.flushSize,
  });
}

export async function ingestCollectionMembershipStream(input: {
  shopId: string;
  stream: NodeJS.ReadableStream;
  flushSize?: number;
}): Promise<IngestCollectionMembershipResult> {
  const flushSize = input.flushSize ?? DEFAULT_FLUSH_SIZE;
  const rows: MembershipRow[] = [];
  let currentProductId: string | null = null;
  let processedMemberships = 0;

  for await (const line of streamJsonl<Record<string, unknown>>(
    input.stream as never,
  )) {
    if (isProductLine(line)) {
      currentProductId = line.id;
      continue;
    }

    if (isCollectionLine(line) && currentProductId && line.__parentId === currentProductId) {
      rows.push({
        shopId: input.shopId,
        productGid: currentProductId,
        collectionGid: line.id,
        collectionTitle:
          typeof line.title === "string" && line.title.trim() !== "" ? line.title : null,
        isManual: !Boolean(line.ruleSet),
        lastObservedAt: new Date(),
      });
      processedMemberships += 1;

      if (rows.length >= flushSize) {
        await flushMembershipBatch(rows);
        rows.length = 0;
      }
    }
  }

  if (rows.length > 0) {
    await flushMembershipBatch(rows);
  }

  return { processedMemberships };
}

function isProductLine(value: Record<string, unknown>): value is ProductLine {
  return typeof value.id === "string" && !("__parentId" in value);
}

function isCollectionLine(value: Record<string, unknown>): value is CollectionLine {
  return typeof value.id === "string" && typeof value.__parentId === "string";
}

async function flushMembershipBatch(rows: MembershipRow[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO product_collection_membership (
          shop_id,
          product_gid,
          collection_gid,
          collection_title,
          is_manual,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.productGid},
          ${row.collectionGid},
          ${row.collectionTitle},
          ${row.isManual},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, product_gid, collection_gid)
        DO UPDATE SET
          collection_title = EXCLUDED.collection_title,
          is_manual = EXCLUDED.is_manual,
          last_observed_at = EXCLUDED.last_observed_at,
          updated_at = NOW()
      `;
    }
  });
}