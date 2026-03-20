// ============================================
// productBulkEditPreview.service.js (FINAL CLEAN)
// ============================================

import { buildProductPrismaWhere } from "../product/productFilterCompiler.service.js"; // ✅ NEW

import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { productRepository } from "../../repositories/product.repository.js";

import {
  buildProductInclude,
  isVariantLevelField,
} from "../../domain/productFields/fieldMeta.js";

import { buildBulkEditSubscriptionWarning } from "../subscription/subscriptionGuard.service.js";

// ============================================
// HELPERS
// ============================================

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizePreviewProduct(rawProduct) {
  const safeProduct =
    rawProduct && typeof rawProduct === "object" ? rawProduct : {};

  return {
    ...safeProduct,
    variants: Array.isArray(safeProduct.variants) ? safeProduct.variants : [],
    options: Array.isArray(safeProduct.options)
      ? safeProduct.options
      : Array.isArray(safeProduct.optionsJson)
        ? safeProduct.optionsJson
        : [],
  };
}

// ============================================
// PREVIEW BULK EDIT
// ============================================

export async function previewBulkEditProducts({
  shop,
  field,
  editType,
  editValue,
  filterParams,
  searchKey,
  replaceText,
  supportValue,
  page = 1,
  limit = 20,
  lang,
  subscription = {},
}) {
  const normalizedShop = normalizeShop(shop);
  const normalizedField = normalizeString(field);
  const normalizedLang = normalizeString(lang);

  const currentPage = normalizePositiveInt(page, 1, 100000);
  const perPage = normalizePositiveInt(limit, 20, 100);
  const skip = (currentPage - 1) * perPage;

  const changes = [];
  const isVariant = isVariantLevelField(normalizedField);

  // ✅ NEW FILTER BUILDER
  const where = buildProductPrismaWhere(
    filterParams ?? [],
    normalizedShop,
  );

  const include = buildProductInclude(normalizedField);

  const [products, count] = await Promise.all([
    productRepository.findManyForBulkPreview({
      where,
      include,
      skip,
      take: perPage,
    }),
    productRepository.countByWhere(where),
  ]);

  const subscriptionWarning = buildBulkEditSubscriptionWarning({
    count,
    subscription,
  });

  const preview = [];

  for (const rawProduct of products) {
    const product = normalizePreviewProduct(rawProduct);

    const result = getUpdatedProducts({
      product,
      field: normalizedField,
      editType,
      value: editValue,
      changes,
      searchKey,
      replaceText,
      supportValue,
      isTracking: true,
    });

    if (result) {
      preview.push(result);
    }
  }

  return {
    message: "tracking successful",
    data: {
      preview,
      field:
        FIELD_TRANSLATIONS?.[normalizedField]?.[normalizedLang] ||
        normalizedField,
      isVariant,
      pagination: {
        total: count,
        page: currentPage,
        limit: perPage,
        totalPages: Math.ceil(count / perPage),
        hasNextPage: skip + perPage < count,
        hasPrevPage: currentPage > 1,
      },
    },
    subscription: subscriptionWarning
      ? { warning: subscriptionWarning }
      : {},
  };
}