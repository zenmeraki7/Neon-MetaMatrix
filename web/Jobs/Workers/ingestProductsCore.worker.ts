import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { downloadBulkResult } from "../../services/shopify/bulk/downloadBulkResult";
import { streamJsonl } from "../../services/shopify/bulk/jsonlStream";

const prisma = new PrismaClient();
const DEFAULT_FLUSH_SIZE = 250;

type ProductNodeLine = {
  __parentId?: string;
  id: string;
  legacyResourceId?: string | number | null;
  title?: string | null;
  handle?: string | null;
  description?: string | null;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  templateSuffix?: string | null;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  featuredMedia?: { id?: string | null } | null;
};

type ProductOptionLine = {
  __parentId: string;
  name?: string | null;
  position?: number | null;
};

type ProductAggregate = {
  product: ProductNodeLine;
  options: ProductOptionLine[];
};

type ProductMirrorRow = {
  shopId: string;
  productGid: string;
  legacyProductId: bigint | null;
  title: string;
  handle: string;
  descriptionText: string | null;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  templateSuffix: string | null;
  tags: string[];
  createdAtShopify: Date | null;
  updatedAtShopify: Date | null;
  publishedAtShopify: Date | null;
  hasImages: boolean;
  option1Name: string | null;
  option2Name: string | null;
  option3Name: string | null;
  shopifyUpdatedAt: Date | null;
  lastObservedAt: Date;
};

type ProductRawSnapshotRow = {
  shopId: string;
  productGid: string;
  rawDocument: Prisma.InputJsonValue;
  rawMetafields: Prisma.InputJsonValue | null;
  rawPublications: Prisma.InputJsonValue | null;
  rawSeo: Prisma.InputJsonValue | null;
  documentHash: string;
  shopifyUpdatedAt: Date | null;
  lastObservedAt: Date;
};

export interface IngestProductsCoreInput {
  shopId: string;
  bulkResultUrl: string;
  flushSize?: number;
}

export interface IngestProductsCoreResult {
  processedProducts: number;
}

export async function ingestProductsCoreFromBulkUrl(
  input: IngestProductsCoreInput,
): Promise<IngestProductsCoreResult> {
  const stream = await downloadBulkResult({
    url: input.bulkResultUrl,
    expectedContentTypeIncludes: ["jsonl", "text/plain", "application/octet-stream"],
  });

  return ingestProductsCoreStream({
    shopId: input.shopId,
    stream,
    flushSize: input.flushSize,
  });
}

export async function ingestProductsCoreStream(input: {
  shopId: string;
  stream: NodeJS.ReadableStream;
  flushSize?: number;
}): Promise<IngestProductsCoreResult> {
  const flushSize = input.flushSize ?? DEFAULT_FLUSH_SIZE;
  const productRows: ProductMirrorRow[] = [];
  const rawRows: ProductRawSnapshotRow[] = [];

  let current: ProductAggregate | null = null;
  let processedProducts = 0;

  for await (const line of streamJsonl<Record<string, unknown>>(
    input.stream as never,
  )) {
    if (isProductNodeLine(line)) {
      if (current) {
        const normalized = normalizeProductAggregate(input.shopId, current);
        productRows.push(normalized.productRow);
        rawRows.push(normalized.rawRow);
        processedProducts += 1;
      }

      current = {
        product: line,
        options: [],
      };

      if (productRows.length >= flushSize) {
        await flushProductBatch(productRows, rawRows);
        productRows.length = 0;
        rawRows.length = 0;
      }

      continue;
    }

    if (isProductOptionLine(line) && current && line.__parentId === current.product.id) {
      current.options.push(line);
    }
  }

  if (current) {
    const normalized = normalizeProductAggregate(input.shopId, current);
    productRows.push(normalized.productRow);
    rawRows.push(normalized.rawRow);
    processedProducts += 1;
  }

  if (productRows.length > 0) {
    await flushProductBatch(productRows, rawRows);
  }

  return { processedProducts };
}

function isProductNodeLine(value: Record<string, unknown>): value is ProductNodeLine {
  return (
    typeof value.id === "string" &&
    !("__parentId" in value) &&
    ("handle" in value || "title" in value || "productType" in value)
  );
}

function isProductOptionLine(value: Record<string, unknown>): value is ProductOptionLine {
  return (
    typeof value.__parentId === "string" &&
    ("position" in value || "name" in value) &&
    !("handle" in value)
  );
}

function normalizeProductAggregate(
  shopId: string,
  aggregate: ProductAggregate,
): { productRow: ProductMirrorRow; rawRow: ProductRawSnapshotRow } {
  const now = new Date();
  const sortedOptions = [...aggregate.options].sort(
    (a, b) => Number(a.position ?? 999) - Number(b.position ?? 999),
  );

  const option1Name = coerceNullableString(sortedOptions[0]?.name);
  const option2Name = coerceNullableString(sortedOptions[1]?.name);
  const option3Name = coerceNullableString(sortedOptions[2]?.name);
  const shopifyUpdatedAt = parseNullableDate(aggregate.product.updatedAt);

  const rawDocument = {
    ...aggregate.product,
    options: sortedOptions.map((option) => ({
      name: option.name ?? null,
      position: option.position ?? null,
    })),
  } satisfies Prisma.InputJsonValue;

  return {
    productRow: {
      shopId,
      productGid: aggregate.product.id,
      legacyProductId: parseNullableBigInt(aggregate.product.legacyResourceId),
      title: coerceRequiredString(aggregate.product.title, "Untitled product"),
      handle: coerceRequiredString(aggregate.product.handle, aggregate.product.id),
      descriptionText: coerceNullableString(aggregate.product.description),
      vendor: coerceNullableString(aggregate.product.vendor),
      productType: coerceNullableString(aggregate.product.productType),
      status: coerceNullableString(aggregate.product.status),
      templateSuffix: coerceNullableString(aggregate.product.templateSuffix),
      tags: Array.isArray(aggregate.product.tags)
        ? aggregate.product.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      createdAtShopify: parseNullableDate(aggregate.product.createdAt),
      updatedAtShopify: shopifyUpdatedAt,
      publishedAtShopify: parseNullableDate(aggregate.product.publishedAt),
      hasImages: Boolean(aggregate.product.featuredMedia?.id),
      option1Name,
      option2Name,
      option3Name,
      shopifyUpdatedAt,
      lastObservedAt: now,
    },
    rawRow: {
      shopId,
      productGid: aggregate.product.id,
      rawDocument,
      rawMetafields: null,
      rawPublications: null,
      rawSeo: null,
      documentHash: sha256Hex(rawDocument),
      shopifyUpdatedAt,
      lastObservedAt: now,
    },
  };
}

async function flushProductBatch(
  productRows: ProductMirrorRow[],
  rawRows: ProductRawSnapshotRow[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const row of productRows) {
      await tx.$executeRaw`
        INSERT INTO product_mirror (
          shop_id,
          product_gid,
          legacy_product_id,
          title,
          handle,
          description_text,
          vendor,
          product_type,
          status,
          template_suffix,
          tags,
          created_at_shopify,
          updated_at_shopify,
          published_at_shopify,
          has_images,
          option1_name,
          option2_name,
          option3_name,
          shopify_updated_at,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.productGid},
          ${row.legacyProductId},
          ${row.title},
          ${row.handle},
          ${row.descriptionText},
          ${row.vendor},
          ${row.productType},
          ${row.status},
          ${row.templateSuffix},
          ${row.tags}::text[],
          ${row.createdAtShopify},
          ${row.updatedAtShopify},
          ${row.publishedAtShopify},
          ${row.hasImages},
          ${row.option1Name},
          ${row.option2Name},
          ${row.option3Name},
          ${row.shopifyUpdatedAt},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, product_gid)
        DO UPDATE SET
          legacy_product_id = EXCLUDED.legacy_product_id,
          title = EXCLUDED.title,
          handle = EXCLUDED.handle,
          description_text = EXCLUDED.description_text,
          vendor = EXCLUDED.vendor,
          product_type = EXCLUDED.product_type,
          status = EXCLUDED.status,
          template_suffix = EXCLUDED.template_suffix,
          tags = EXCLUDED.tags,
          created_at_shopify = EXCLUDED.created_at_shopify,
          updated_at_shopify = EXCLUDED.updated_at_shopify,
          published_at_shopify = EXCLUDED.published_at_shopify,
          has_images = EXCLUDED.has_images,
          option1_name = EXCLUDED.option1_name,
          option2_name = EXCLUDED.option2_name,
          option3_name = EXCLUDED.option3_name,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          last_observed_at = EXCLUDED.last_observed_at,
          deleted_at = NULL,
          updated_at = NOW()
        WHERE
          product_mirror.shopify_updated_at IS NULL
          OR EXCLUDED.shopify_updated_at IS NULL
          OR product_mirror.shopify_updated_at <= EXCLUDED.shopify_updated_at
      `;
    }

    for (const row of rawRows) {
      await tx.$executeRaw`
        INSERT INTO product_raw_snapshot (
          shop_id,
          product_gid,
          raw_document,
          raw_metafields,
          raw_publications,
          raw_seo,
          document_hash,
          shopify_updated_at,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${row.shopId}::uuid,
          ${row.productGid},
          ${row.rawDocument}::jsonb,
          ${row.rawMetafields}::jsonb,
          ${row.rawPublications}::jsonb,
          ${row.rawSeo}::jsonb,
          ${row.documentHash},
          ${row.shopifyUpdatedAt},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
        ON CONFLICT (shop_id, product_gid)
        DO UPDATE SET
          raw_document = EXCLUDED.raw_document,
          raw_metafields = EXCLUDED.raw_metafields,
          raw_publications = EXCLUDED.raw_publications,
          raw_seo = EXCLUDED.raw_seo,
          document_hash = EXCLUDED.document_hash,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          last_observed_at = EXCLUDED.last_observed_at,
          updated_at = NOW()
        WHERE
          product_raw_snapshot.shopify_updated_at IS NULL
          OR EXCLUDED.shopify_updated_at IS NULL
          OR product_raw_snapshot.shopify_updated_at <= EXCLUDED.shopify_updated_at
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

function coerceNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function coerceRequiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function sha256Hex(value: Prisma.InputJsonValue): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}