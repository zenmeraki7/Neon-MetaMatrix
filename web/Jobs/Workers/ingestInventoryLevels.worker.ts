import { PrismaClient } from "@prisma/client";
import { downloadBulkResult } from "../../services/shopify/bulk/downloadBulkResult";
import { streamJsonl } from "../../services/shopify/bulk/jsonlStream";

const prisma = new PrismaClient();
const DEFAULT_FLUSH_SIZE = 1_000;

type InventoryItemLine = {
  __parentId?: string;
  id: string;
  variant?: { id?: string | null } | null;
};

type InventoryLevelLine = {
  __parentId: string;
  updatedAt?: string | null;
  location?: { id?: string | null; name?: string | null } | null;
  quantities?: Array<{
    name?: string | null;
    quantity?: number | null;
  }> | null;
};

type InventoryLevelRow = {
  shopId: string;
  inventoryItemGid: string;
  variantGid: string | null;
  locationGid: string;
  locationName: string | null;
  available: number | null;
  onHand: number | null;
  updatedAtShopify: Date | null;
  lastObservedAt: Date;
};

export interface IngestInventoryLevelsInput {
  shopId: string;
  bulkResultUrl: string;
  flushSize?: number;
}

export interface IngestInventoryLevelsResult {
  processedInventoryLevels: number;
}

export async function ingestInventoryLevelsFromBulkUrl(
  input: IngestInventoryLevelsInput,
): Promise<IngestInventoryLevelsResult> {
  const stream = await downloadBulkResult({
    url: input.bulkResultUrl,
    expectedContentTypeIncludes: ["jsonl", "text/plain", "application/octet-stream"],
  });

  return ingestInventoryLevelsStream({
    shopId: input.shopId,
    stream,
    flushSize: input.flushSize,
  });
}

export async function ingestInventoryLevelsStream(input: {
  shopId: string;
  stream: NodeJS.ReadableStream;
  flushSize?: number;
}): Promise<IngestInventoryLevelsResult> {
  const flushSize = input.flushSize ?? DEFAULT_FLUSH_SIZE;
  const rows: InventoryLevelRow[] = [];

  let currentInventoryItemId: string | null = null;
  let currentVariantId: string | null = null;
  let processedInventoryLevels = 0;

  for await (const line of streamJsonl<Record<string, unknown>>(
    input.stream as never,
  )) {
    if (isInventoryItemLine(line)) {
      currentInventoryItemId = line.id;
      currentVariantId =
        typeof line.variant?.id === "string" && line.variant.id.trim() !== ""
          ? line.variant.id
          : null;
      continue;
    }

    if (
      isInventoryLevelLine(line) &&
      currentInventoryItemId &&
      line.__parentId === currentInventoryItemId
    ) {
      const available = extractQuantity(line.quantities, "available");
      const onHand = extractQuantity(line.quantities, "on_hand");
      const locationGid =
        typeof line.location?.id === "string" && line.location.id.trim() !== ""
          ? line.location.id
          : null;

      if (!locationGid) {
        continue;
      }

      rows.push({
        shopId: input.shopId,
        inventoryItemGid: currentInventoryItemId,
        variantGid: currentVariantId,
        locationGid,
        locationName:
          typeof line.location?.name === "string" && line.location.name.trim() !== ""
            ? line.location.name
            : null,
        available,
        onHand,
        updatedAtShopify: parseNullableDate(line.updatedAt),
        lastObservedAt: new Date(),
      });
      processedInventoryLevels += 1;

      if (rows.length >= flushSize) {
        await flushInventoryLevelBatch(rows);
        rows.length = 0;
      }
    }
  }

  if (rows.length > 0) {
    await flushInventoryLevelBatch(rows);
  }

  return { processedInventoryLevels };
}

function isInventoryItemLine(value: Record<string, unknown>): value is InventoryItemLine {
  return (
    typeof value.id === "string" &&
    !("__parentId" in value) &&
    ("variant" in value || "inventoryLevels" in value)
  );
}

function isInventoryLevelLine(value: Record<string, unknown>): value is InventoryLevelLine {
  return typeof value.__parentId === "string" && ("location" in value || "quantities" in value);
}

async function flushInventoryLevelBatch(rows: InventoryLevelRow[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO inventory_level_mirror (
          shop_id,
          inventory_item_gid,
          variant_gid,
          location_gid,
          location_name,
          available,
          on_hand,
          updated_at_shopify,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.inventoryItemGid},
          ${row.variantGid},
          ${row.locationGid},
          ${row.locationName},
          ${row.available},
          ${row.onHand},
          ${row.updatedAtShopify},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, inventory_item_gid, location_gid)
        DO UPDATE SET
          variant_gid = EXCLUDED.variant_gid,
          location_name = EXCLUDED.location_name,
          available = EXCLUDED.available,
          on_hand = EXCLUDED.on_hand,
          updated_at_shopify = EXCLUDED.updated_at_shopify,
          last_observed_at = EXCLUDED.last_observed_at,
          updated_at = NOW()
        WHERE
          inventory_level_mirror.updated_at_shopify IS NULL
          OR EXCLUDED.updated_at_shopify IS NULL
          OR inventory_level_mirror.updated_at_shopify <= EXCLUDED.updated_at_shopify
      `;
    }
  });
}

function extractQuantity(
  quantities: Array<{ name?: string | null; quantity?: number | null }> | null | undefined,
  targetName: string,
): number | null {
  if (!Array.isArray(quantities)) {
    return null;
  }

  const match = quantities.find((item) => item?.name === targetName);
  return typeof match?.quantity === "number" ? match.quantity : null;
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}