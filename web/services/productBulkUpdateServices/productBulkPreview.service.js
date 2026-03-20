import { buildProductPrismaWhere } from "../../services/product/productFilterCompiler.service.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

const VARIANT_LEVEL_FIELDS = new Set([
  "price",
  "barcode",
  "sku",
  "inventory",
  "taxable",
  "compareAtPrice",
  "option1Values",
  "option2Values",
  "option3Values",
  "inventoryPolicy",
  "cost",
  "requiresShipping",
  "weight",
  "weightUnit",
]);

function isVariantLevelField(field) {
  if (FIELD_CONFIGS?.[field]?.isVariantLevel) return true;
  return VARIANT_LEVEL_FIELDS.has(field);
}

function buildProductInclude(field) {
  if (isVariantLevelField(field) || OPTION_NAME_FIELDS.has(field)) {
    return { variants: true };
  }
  return undefined;
}

function normalizePreviewProduct(rawProduct) {
  return {
    ...rawProduct,
    variants: Array.isArray(rawProduct?.variants) ? rawProduct.variants : [],
    options: Array.isArray(rawProduct?.options)
      ? rawProduct.options
      : Array.isArray(rawProduct?.optionsJson)
        ? rawProduct.optionsJson
        : [],
  };
}

export class ProductBulkPreviewService {
  constructor(session, repository) {
    this.session = session;
    this.repository = repository;
  }

  async trackEditProducts({
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
    const changes = [];
    const isVariant = isVariantLevelField(field);

    // ✅ NEW FILTER SYSTEM
    const where = buildProductPrismaWhere(
      filterParams ?? [],
      this.session.shop,
    );

    const currentPage = Number.parseInt(page, 10) || 1;
    const perPage = Number.parseInt(limit, 10) || 20;
    const skip = (currentPage - 1) * perPage;
    const include = buildProductInclude(field);

    const products = await this.repository.findProductsForPreview({
      where,
      include,
      skip,
      take: perPage,
    });

    const count = await this.repository.countProducts(where);

    const productLimit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    let subscriptionWarning = null;

    if (!isUnlimited) {
      if (count > productLimit) {
        subscriptionWarning = {
          type: "LIMIT_EXCEEDED",
          message: `Your current plan (${planName}) allows editing up to ${productLimit} products. You're trying to edit ${count} products.`,
        };
      } else if (count > productLimit * 0.8) {
        const remaining = productLimit - count;
        subscriptionWarning = {
          type: "APPROACHING_LIMIT",
          message: `You're editing ${count} products. ${remaining} remaining.`,
        };
      }
    }

    const formattedProducts = [];

    for (const rawProduct of products) {
      const product = normalizePreviewProduct(rawProduct);

      const result = getUpdatedProducts({
        product,
        field,
        editType,
        value: editValue,
        changes,
        searchKey,
        replaceText,
        supportValue,
        isTracking: true,
      });

      if (result) {
        formattedProducts.push(result);
      }
    }

    return {
      message: "tracking successful",
      data: {
        preview: formattedProducts,
        field: FIELD_TRANSLATIONS?.[field]?.[lang] || field,
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
      subscription: subscriptionWarning ? { warning: subscriptionWarning } : {},
    };
  }
}