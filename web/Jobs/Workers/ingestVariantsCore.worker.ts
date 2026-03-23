import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { downloadBulkResult } from "../../services/shopify/bulk/downloadBulkResult";
import { streamJsonl } from "../../services/shopify/bulk/jsonlStream";

const prisma = new PrismaClient();
const DEFAULT_FLUSH_SIZE = 300;

type VariantNodeLine = {
  __parentId?: string;
  id: string;
  legacyResourceId?: string | number | null;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | number | null;
  compareAtPrice?: string | number | null;
  taxable?: boolean | null;
  inventoryPolicy?: string | null;
  inventoryQuantity?: number | null;
  requiresShipping?: boolean | null;
  weight?: string | number | null;
  weightUnit?: string | null;
  updatedAt?: string | null;
  product?: { id?: string | null } | null;
  inventoryItem?: {
    id?: string | null;
    tracked?: boolean | null;
    countryCodeOfOrigin?: string | null;
    harmonizedSystemCode?: string | null;
    unitCost?: { amount?: string | number | null; currencyCode?: string | null } | null;
  } | null;
};

type SelectedOptionLine = {
  __parentId: string;
  name?: string | null;
  value?: string | null;
};

type VariantAggregate = {
  variant: VariantNodeLine;
  selectedOptions: SelectedOptionLine[];
};

type VariantMirrorRow = {
  shopId: string;
  variantGid: string;
  productGid: string;
  inventoryItemGid: string | null;
  legacyVariantId: bigint | null;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: Prisma.Decimal | null;
  compareAtPrice: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  taxable: boolean | null;
  requiresShipping: boolean | null;
  inventoryPolicy: string | null;
  inventoryTracked: boolean | null;
  inventoryQuantityRollup: number;
  option1Value: string | null;
  option2Value: string | null;
  option3Value: string | null;
  weight: Prisma.Decimal | null;
  weightUnit: string | null;
  weightGrams: number | null;
  countryOfOrigin: string | null;
  hsTariffCode: string | null;
  shopifyUpdatedAt: Date | null;
  lastObservedAt: Date;
};

type VariantRawSnapshotRow = {
  shopId: string;
  variantGid: string;
  productGid: string;
  rawDocument: Prisma.InputJsonValue;
  rawMetafields: Prisma.InputJsonValue | null;
  rawInventoryItem: Prisma.InputJsonValue | null;
  documentHash: string;
  shopifyUpdatedAt: Date | null;
  lastObservedAt: Date;
};

export interface IngestVariantsCoreInput {
  shopId: string;
  bulkResultUrl: string;
  flushSize?: number;
}

export interface IngestVariantsCoreResult {
  processedVariants: number;
}

export async function ingestVariantsCoreFromBulkUrl(
  input: IngestVariantsCoreInput,
): Promise<IngestVariantsCoreResult> {
  const stream = await downloadBulkResult({
    url: input.bulkResultUrl,
    expectedContentTypeIncludes: ["jsonl", "text/plain", "application/octet-stream"],
  });

  return ingestVariantsCoreStream({
    shopId: input.shopId,
    stream,
    flushSize: input.flushSize,
  });
}

export async function ingestVariantsCoreStream(input: {
  shopId: string;
  stream: NodeJS.ReadableStream;
  flushSize?: number;
}): Promise<IngestVariantsCoreResult> {
  const flushSize = input.flushSize ?? DEFAULT_FLUSH_SIZE;
  const variantRows: VariantMirrorRow[] = [];
  const rawRows: VariantRawSnapshotRow[] = [];

  let current: VariantAggregate | null = null;
  let processedVariants = 0;

  for await (const line of streamJsonl<Record<string, unknown>>(
    input.stream as never,
  )) {
    if (isVariantNodeLine(line)) {
      if (current) {
        const normalized = normalizeVariantAggregate(input.shopId, current);
        variantRows.push(normalized.variantRow);
        rawRows.push(normalized.rawRow);
        processedVariants += 1;
      }

      current = {
        variant: line,
        selectedOptions: [],
      };

      if (variantRows.length >= flushSize) {
        await flushVariantBatch(variantRows, rawRows);
        variantRows.length = 0;
        rawRows.length = 0;
      }

      continue;
    }

    if (isSelectedOptionLine(line) && current && line.__parentId === current.variant.id) {
      current.selectedOptions.push(line);
    }
  }

  if (current) {
    const normalized = normalizeVariantAggregate(input.shopId, current);
    variantRows.push(normalized.variantRow);
    rawRows.push(normalized.rawRow);
    processedVariants += 1;
  }

  if (variantRows.length > 0) {
    await flushVariantBatch(variantRows, rawRows);
  }

  return { processedVariants };
}

function isVariantNodeLine(value: Record<string, unknown>): value is VariantNodeLine {
  return (
    typeof value.id === "string" &&
    !("__parentId" in value) &&
    ("product" in value || "inventoryItem" in value || "sku" in value || "barcode" in value)
  );
}

function isSelectedOptionLine(value: Record<string, unknown>): value is SelectedOptionLine {
  return (
    typeof value.__parentId === "string" &&
    ("name" in value || "value" in value) &&
    !("product" in value)
  );
}

function normalizeVariantAggregate(
  shopId: string,
  aggregate: VariantAggregate,
): { variantRow: VariantMirrorRow; rawRow: VariantRawSnapshotRow } {
  const now = new Date();
  const selectedOptions = aggregate.selectedOptions.map((option) => ({
    name: coerceNullableString(option.name),
    value: coerceNullableString(option.value),
  }));

  const option1Value = selectedOptions[0]?.value ?? null;
  const option2Value = selectedOptions[1]?.value ?? null;
  const option3Value = selectedOptions[2]?.value ?? null;

  const inventoryItem = aggregate.variant.inventoryItem ?? null;
  const shopifyUpdatedAt = parseNullableDate(aggregate.variant.updatedAt);

  const rawDocument = {
    ...aggregate.variant,
    selectedOptions,
  } satisfies Prisma.InputJsonValue;

  return {
    variantRow: {
      shopId,
      variantGid: aggregate.variant.id,
      productGid: coerceRequiredString(aggregate.variant.product?.id, ""),
      inventoryItemGid: coerceNullableString(inventoryItem?.id),
      legacyVariantId: parseNullableBigInt(aggregate.variant.legacyResourceId),
      title: coerceNullableString(aggregate.variant.title),
      sku: coerceNullableString(aggregate.variant.sku),
      barcode: coerceNullableString(aggregate.variant.barcode),
      price: parseNullableDecimal(aggregate.variant.price),
      compareAtPrice: parseNullableDecimal(aggregate.variant.compareAtPrice),
      cost: parseNullableDecimal(inventoryItem?.unitCost?.amount),
      taxable: typeof aggregate.variant.taxable === "boolean" ? aggregate.variant.taxable : null,
      requiresShipping:
        typeof aggregate.variant.requiresShipping === "boolean"
          ? aggregate.variant.requiresShipping
          : null,
      inventoryPolicy: coerceNullableString(aggregate.variant.inventoryPolicy),
      inventoryTracked:
        typeof inventoryItem?.tracked === "boolean" ? inventoryItem.tracked : null,
      inventoryQuantityRollup:
        typeof aggregate.variant.inventoryQuantity === "number"
          ? aggregate.variant.inventoryQuantity
          : 0,
      option1Value,
      option2Value,
      option3Value,
      weight: parseNullableDecimal(aggregate.variant.weight),
      weightUnit: coerceNullableString(aggregate.variant.weightUnit),
      weightGrams: computeWeightGrams(
        aggregate.variant.weight,
        aggregate.variant.weightUnit,
      ),
      countryOfOrigin: coerceNullableString(inventoryItem?.countryCodeOfOrigin),
      hsTariffCode: coerceNullableString(inventoryItem?.harmonizedSystemCode),
      shopifyUpdatedAt,
      lastObservedAt: now,
    },
    rawRow: {
      shopId,
      variantGid: aggregate.variant.id,
      productGid: coerceRequiredString(aggregate.variant.product?.id, ""),
      rawDocument,
      rawMetafields: null,
      rawInventoryItem: (inventoryItem ?? null) as Prisma.InputJsonValue | null,
      documentHash: sha256Hex(rawDocument),
      shopifyUpdatedAt,
      lastObservedAt: now,
    },
  };
}

async function flushVariantBatch(
  variantRows: VariantMirrorRow[],
  rawRows: VariantRawSnapshotRow[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const row of variantRows) {
      await tx.$executeRaw`
        INSERT INTO variant_mirror (
          shop_id,
          variant_gid,
          product_gid,
          inventory_item_gid,
          legacy_variant_id,
          title,
          sku,
          barcode,
          price,
          compare_at_price,
          cost,
          taxable,
          requires_shipping,
          inventory_policy,
          inventory_tracked,
          inventory_quantity_rollup,
          option1_value,
          option2_value,
          option3_value,
          weight,
          weight_unit,
          weight_grams,
          country_of_origin,
          hs_tariff_code,
          shopify_updated_at,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.variantGid},
          ${row.productGid},
          ${row.inventoryItemGid},
          ${row.legacyVariantId},
          ${row.title},
          ${row.sku},
          ${row.barcode},
          ${row.price},
          ${row.compareAtPrice},
          ${row.cost},
          ${row.taxable},
          ${row.requiresShipping},
          ${row.inventoryPolicy},
          ${row.inventoryTracked},
          ${row.inventoryQuantityRollup},
          ${row.option1Value},
          ${row.option2Value},
          ${row.option3Value},
          ${row.weight},
          ${row.weightUnit},
          ${row.weightGrams},
          ${row.countryOfOrigin},
          ${row.hsTariffCode},
          ${row.shopifyUpdatedAt},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, variant_gid)
        DO UPDATE SET
          product_gid = EXCLUDED.product_gid,
          inventory_item_gid = EXCLUDED.inventory_item_gid,
          legacy_variant_id = EXCLUDED.legacy_variant_id,
          title = EXCLUDED.title,
          sku = EXCLUDED.sku,
          barcode = EXCLUDED.barcode,
          price = EXCLUDED.price,
          compare_at_price = EXCLUDED.compare_at_price,
          cost = EXCLUDED.cost,
          taxable = EXCLUDED.taxable,
          requires_shipping = EXCLUDED.requires_shipping,
          inventory_policy = EXCLUDED.inventory_policy,
          inventory_tracked = EXCLUDED.inventory_tracked,
          inventory_quantity_rollup = EXCLUDED.inventory_quantity_rollup,
          option1_value = EXCLUDED.option1_value,
          option2_value = EXCLUDED.option2_value,
          option3_value = EXCLUDED.option3_value,
          weight = EXCLUDED.weight,
          weight_unit = EXCLUDED.weight_unit,
          weight_grams = EXCLUDED.weight_grams,
          country_of_origin = EXCLUDED.country_of_origin,
          hs_tariff_code = EXCLUDED.hs_tariff_code,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          last_observed_at = EXCLUDED.last_observed_at,
          deleted_at = NULL,
          updated_at = NOW()
        WHERE
          variant_mirror.shopify_updated_at IS NULL
          OR EXCLUDED.shopify_updated_at IS NULL
          OR variant_mirror.shopify_updated_at <= EXCLUDED.shopify_updated_at
      `;
    }

    for (const row of rawRows) {
      await tx.$executeRaw`
        INSERT INTO variant_raw_snapshot (
          shop_id,
          variant_gid,
          product_gid,
          raw_document,
          raw_metafields,
          raw_inventory_item,
          document_hash,
          shopify_updated_at,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.variantGid},
          ${row.productGid},
          ${row.rawDocument}::jsonb,
          ${row.rawMetafields}::jsonb,
          ${row.rawInventoryItem}::jsonb,
          ${row.documentHash},
          ${row.shopifyUpdatedAt},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, variant_gid)
        DO UPDATE SET
          product_gid = EXCLUDED.product_gid,
          raw_document = EXCLUDED.raw_document,
          raw_metafields = EXCLUDED.raw_metafields,
          raw_inventory_item = EXCLUDED.raw_inventory_item,
          document_hash = EXCLUDED.document_hash,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          last_observed_at = EXCLUDED.last_observed_at,
          updated_at = NOW()
        WHERE
          variant_raw_snapshot.shopify_updated_at IS NULL
          OR EXCLUDED.shopify_updated_at IS NULL
          OR variant_raw_snapshot.shopify_updated_at <= EXCLUDED.shopify_updated_at
      `;
    }
  });
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNullableBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  return null;
}

function parseNullableDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Prisma.Decimal(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return new Prisma.Decimal(value);
    } catch {
      return null;
    }
  }

  return null;
}

function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function coerceRequiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function computeWeightGrams(weight: unknown, unit: unknown): number | null {
  const numericWeight =
    typeof weight === "number"
      ? weight
      : typeof weight === "string" && weight.trim() !== ""
        ? Number(weight)
        : NaN;

  if (!Number.isFinite(numericWeight)) {
    return null;
  }

  switch (String(unit ?? "").toUpperCase()) {
    case "GRAMS":
    case "G":
      return Math.round(numericWeight);
    case "KILOGRAMS":
    case "KG":
      return Math.round(numericWeight * 1000);
    case "OUNCES":
    case "OZ":
      return Math.round(numericWeight * 28.349523125);
    case "POUNDS":
    case "LB":
    case "LBS":
      return Math.round(numericWeight * 453.59237);
    default:
      return null;
  }
}

function sha256Hex(value: Prisma.InputJsonValue): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}