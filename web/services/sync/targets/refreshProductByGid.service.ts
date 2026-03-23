import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ShopifyAdminGraphqlClient } from "../../shopify/adminGraphql.client";
import { findShopSyncCredentials } from "../../../repositories/shop.repository";

const prisma = new PrismaClient();

type ProductQueryResponse = {
  product: ProductNode | null;
};

type ProductNode = {
  id: string;
  legacyResourceId?: string | null;
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
  options?: Array<{
    name?: string | null;
    position?: number | null;
  }> | null;
  seo?: {
    title?: string | null;
    description?: string | null;
  } | null;
};

export interface RefreshProductByGidInput {
  shopId: string;
  productGid: string;
}

export async function refreshProductByGid(
  input: RefreshProductByGidInput,
): Promise<Record<string, unknown>> {
  const shop = await findShopSyncCredentials(input.shopId);
  if (!shop) {
    throw new Error(`Shop not found: ${input.shopId}`);
  }

  const client = new ShopifyAdminGraphqlClient({
    shopDomain: shop.shopDomain,
    accessToken: shop.accessToken,
    apiVersion: shop.apiVersion,
  });

  const response = await client.request<
    ProductQueryResponse,
    { id: string }
  >(PRODUCT_BY_ID_QUERY, {
    id: input.productGid,
  });

  if (!response.product) {
    await tombstoneMissingProduct({
      shopId: input.shopId,
      productGid: input.productGid,
    });

    return {
      refreshed: true,
      resource: "product",
      productGid: input.productGid,
      deleted: true,
    };
  }

  const normalized = normalizeProduct(response.product);

  await prisma.$transaction(async (tx) => {
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
        deleted_at,
        created_at,
        updated_at
      )
      VALUES (
        ${input.shopId}::uuid,
        ${normalized.productGid},
        ${normalized.legacyProductId},
        ${normalized.title},
        ${normalized.handle},
        ${normalized.descriptionText},
        ${normalized.vendor},
        ${normalized.productType},
        ${normalized.status},
        ${normalized.templateSuffix},
        ${normalized.tags}::text[],
        ${normalized.createdAtShopify},
        ${normalized.updatedAtShopify},
        ${normalized.publishedAtShopify},
        ${normalized.hasImages},
        ${normalized.option1Name},
        ${normalized.option2Name},
        ${normalized.option3Name},
        ${normalized.shopifyUpdatedAt},
        ${normalized.lastObservedAt},
        NULL,
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
        ${input.shopId}::uuid,
        ${normalized.productGid},
        ${normalized.rawDocument}::jsonb,
        NULL::jsonb,
        NULL::jsonb,
        ${normalized.rawSeo}::jsonb,
        ${normalized.documentHash},
        ${normalized.shopifyUpdatedAt},
        ${normalized.lastObservedAt},
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
  });

  return {
    refreshed: true,
    resource: "product",
    productGid: input.productGid,
    deleted: false,
  };
}

async function tombstoneMissingProduct(input: {
  shopId: string;
  productGid: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE product_mirror
      SET
        deleted_at = NOW(),
        last_observed_at = NOW(),
        updated_at = NOW()
      WHERE shop_id = ${input.shopId}::uuid
        AND product_gid = ${input.productGid}
    `;

    await tx.$executeRaw`
      UPDATE variant_mirror
      SET
        deleted_at = NOW(),
        last_observed_at = NOW(),
        updated_at = NOW()
      WHERE shop_id = ${input.shopId}::uuid
        AND product_gid = ${input.productGid}
    `;
  });
}

function normalizeProduct(product: ProductNode): {
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
  rawDocument: Prisma.InputJsonValue;
  rawSeo: Prisma.InputJsonValue | null;
  documentHash: string;
} {
  const now = new Date();
  const options = [...(product.options ?? [])].sort(
    (a, b) => Number(a.position ?? 999) - Number(b.position ?? 999),
  );

  const rawDocument = {
    id: product.id,
    legacyResourceId: product.legacyResourceId ?? null,
    title: product.title ?? null,
    handle: product.handle ?? null,
    description: product.description ?? null,
    vendor: product.vendor ?? null,
    productType: product.productType ?? null,
    status: product.status ?? null,
    templateSuffix: product.templateSuffix ?? null,
    tags: Array.isArray(product.tags) ? product.tags : [],
    createdAt: product.createdAt ?? null,
    updatedAt: product.updatedAt ?? null,
    publishedAt: product.publishedAt ?? null,
    featuredMedia: product.featuredMedia ?? null,
    options: options.map((option) => ({
      name: option.name ?? null,
      position: option.position ?? null,
    })),
    seo: product.seo ?? null,
  } satisfies Prisma.InputJsonValue;

  return {
    productGid: product.id,
    legacyProductId: parseNullableBigInt(product.legacyResourceId),
    title: nonEmpty(product.title, "Untitled product"),
    handle: nonEmpty(product.handle, product.id),
    descriptionText: nullableString(product.description),
    vendor: nullableString(product.vendor),
    productType: nullableString(product.productType),
    status: nullableString(product.status),
    templateSuffix: nullableString(product.templateSuffix),
    tags: Array.isArray(product.tags)
      ? product.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    createdAtShopify: parseNullableDate(product.createdAt),
    updatedAtShopify: parseNullableDate(product.updatedAt),
    publishedAtShopify: parseNullableDate(product.publishedAt),
    hasImages: Boolean(product.featuredMedia?.id),
    option1Name: nullableString(options[0]?.name),
    option2Name: nullableString(options[1]?.name),
    option3Name: nullableString(options[2]?.name),
    shopifyUpdatedAt: parseNullableDate(product.updatedAt),
    lastObservedAt: now,
    rawDocument,
    rawSeo: (product.seo ?? null) as Prisma.InputJsonValue | null,
    documentHash: sha256Hex(rawDocument),
  };
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNullableBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function sha256Hex(value: Prisma.InputJsonValue): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const PRODUCT_BY_ID_QUERY = `
query ProductById($id: ID!) {
  product(id: $id) {
    id
    legacyResourceId
    title
    handle
    description
    vendor
    productType
    status
    templateSuffix
    tags
    createdAt
    updatedAt
    publishedAt
    featuredMedia {
      ... on MediaImage {
        id
      }
    }
    options {
      name
      position
    }
    seo {
      title
      description
    }
  }
}
`;