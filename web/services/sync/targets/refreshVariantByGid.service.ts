import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ShopifyAdminGraphqlClient } from "../../shopify/adminGraphql.client";
import { findShopSyncCredentials } from "../../../repositories/shop.repository";

const prisma = new PrismaClient();

type VariantNodeQueryResponse = {
  node: VariantNode | null;
};

type VariantNode = {
  __typename?: "ProductVariant";
  id: string;
  legacyResourceId?: string | null;
  title?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  taxable?: boolean | null;
  inventoryPolicy?: string | null;
  inventoryQuantity?: number | null;
  requiresShipping?: boolean | null;
  weight?: number | null;
  weightUnit?: string | null;
  updatedAt?: string | null;
  selectedOptions?: Array<{
    name?: string | null;
    value?: string | null;
  }> | null;
  product?: {
    id?: string | null;
  } | null;
  inventoryItem?: {
    id?: string | null;
    tracked?: boolean | null;
    countryCodeOfOrigin?: string | null;
    harmonizedSystemCode?: string | null;
    unitCost?: {
      amount?: string | null;
      currencyCode?: string | null;
    } | null;
  } | null;
};

export interface RefreshVariantByGidInput {
  shopId: string;
  variantGid: string;
}

export async function refreshVariantByGid(
  input: RefreshVariantByGidInput,
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
    VariantNodeQueryResponse,
    { id: string }
  >(VARIANT_BY_ID_QUERY, {
    id: input.variantGid,
  });

  if (!response.node || response.node.__typename !== "ProductVariant") {
    await tombstoneMissingVariant({
      shopId: input.shopId,
      variantGid: input.variantGid,
    });

    return {
      refreshed: true,
      resource: "variant",
      variantGid: input.variantGid,
      deleted: true,
    };
  }

  const normalized = normalizeVariant(response.node);

  await prisma.$transaction(async (tx) => {
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
        deleted_at,
        created_at,
        updated_at
      )
      VALUES (
        ${input.shopId}::uuid,
        ${normalized.variantGid},
        ${normalized.productGid},
        ${normalized.inventoryItemGid},
        ${normalized.legacyVariantId},
        ${normalized.title},
        ${normalized.sku},
        ${normalized.barcode},
        ${normalized.price},
        ${normalized.compareAtPrice},
        ${normalized.cost},
        ${normalized.taxable},
        ${normalized.requiresShipping},
        ${normalized.inventoryPolicy},
        ${normalized.inventoryTracked},
        ${normalized.inventoryQuantityRollup},
        ${normalized.option1Value},
        ${normalized.option2Value},
        ${normalized.option3Value},
        ${normalized.weight},
        ${normalized.weightUnit},
        ${normalized.weightGrams},
        ${normalized.countryOfOrigin},
        ${normalized.hsTariffCode},
        ${normalized.shopifyUpdatedAt},
        ${normalized.lastObservedAt},
        NULL,
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
        ${input.shopId}::uuid,
        ${normalized.variantGid},
        ${normalized.productGid},
        ${normalized.rawDocument}::jsonb,
        NULL::jsonb,
        ${normalized.rawInventoryItem}::jsonb,
        ${normalized.documentHash},
        ${normalized.shopifyUpdatedAt},
        ${normalized.lastObservedAt},
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
  });

  return {
    refreshed: true,
    resource: "variant",
    variantGid: input.variantGid,
    deleted: false,
  };
}

async function tombstoneMissingVariant(input: {
  shopId: string;
  variantGid: string;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE variant_mirror
    SET
      deleted_at = NOW(),
      last_observed_at = NOW(),
      updated_at = NOW()
    WHERE shop_id = ${input.shopId}::uuid
      AND variant_gid = ${input.variantGid}
  `;
}

function normalizeVariant(variant: VariantNode): {
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
  rawDocument: Prisma.InputJsonValue;
  rawInventoryItem: Prisma.InputJsonValue | null;
  documentHash: string;
} {
  const now = new Date();
  const selectedOptions = variant.selectedOptions ?? [];
  const rawDocument = {
    id: variant.id,
    legacyResourceId: variant.legacyResourceId ?? null,
    title: variant.title ?? null,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    price: variant.price ?? null,
    compareAtPrice: variant.compareAtPrice ?? null,
    taxable: variant.taxable ?? null,
    inventoryPolicy: variant.inventoryPolicy ?? null,
    inventoryQuantity: variant.inventoryQuantity ?? null,
    requiresShipping: variant.requiresShipping ?? null,
    weight: variant.weight ?? null,
    weightUnit: variant.weightUnit ?? null,
    updatedAt: variant.updatedAt ?? null,
    selectedOptions: selectedOptions.map((option) => ({
      name: option.name ?? null,
      value: option.value ?? null,
    })),
    product: variant.product ?? null,
    inventoryItem: variant.inventoryItem ?? null,
  } satisfies Prisma.InputJsonValue;

  return {
    variantGid: variant.id,
    productGid: nonEmpty(variant.product?.id, ""),
    inventoryItemGid: nullableString(variant.inventoryItem?.id),
    legacyVariantId: parseNullableBigInt(variant.legacyResourceId),
    title: nullableString(variant.title),
    sku: nullableString(variant.sku),
    barcode: nullableString(variant.barcode),
    price: parseNullableDecimal(variant.price),
    compareAtPrice: parseNullableDecimal(variant.compareAtPrice),
    cost: parseNullableDecimal(variant.inventoryItem?.unitCost?.amount),
    taxable: typeof variant.taxable === "boolean" ? variant.taxable : null,
    requiresShipping:
      typeof variant.requiresShipping === "boolean" ? variant.requiresShipping : null,
    inventoryPolicy: nullableString(variant.inventoryPolicy),
    inventoryTracked:
      typeof variant.inventoryItem?.tracked === "boolean"
        ? variant.inventoryItem.tracked
        : null,
    inventoryQuantityRollup:
      typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : 0,
    option1Value: nullableString(selectedOptions[0]?.value),
    option2Value: nullableString(selectedOptions[1]?.value),
    option3Value: nullableString(selectedOptions[2]?.value),
    weight: parseNullableDecimal(variant.weight),
    weightUnit: nullableString(variant.weightUnit),
    weightGrams: computeWeightGrams(variant.weight, variant.weightUnit),
    countryOfOrigin: nullableString(variant.inventoryItem?.countryCodeOfOrigin),
    hsTariffCode: nullableString(variant.inventoryItem?.harmonizedSystemCode),
    shopifyUpdatedAt: parseNullableDate(variant.updatedAt),
    lastObservedAt: now,
    rawDocument,
    rawInventoryItem: (variant.inventoryItem ?? null) as Prisma.InputJsonValue | null,
    documentHash: sha256Hex(rawDocument),
  };
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

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function computeWeightGrams(weight: unknown, unit: unknown): number | null {
  const numericWeight =
    typeof weight === "number"
      ? weight
      : typeof weight === "string" && weight.trim() !== ""
        ? Number(weight)
        : NaN;

  if (!Number.isFinite(numericWeight)) return null;

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

const VARIANT_BY_ID_QUERY = `
query VariantById($id: ID!) {
  node(id: $id) {
    __typename
    ... on ProductVariant {
      id
      legacyResourceId
      title
      sku
      barcode
      price
      compareAtPrice
      taxable
      inventoryPolicy
      inventoryQuantity
      requiresShipping
      weight
      weightUnit
      updatedAt
      selectedOptions {
        name
        value
      }
      product {
        id
      }
      inventoryItem {
        id
        tracked
        countryCodeOfOrigin
        harmonizedSystemCode
        unitCost {
          amount
          currencyCode
        }
      }
    }
  }
}
`;