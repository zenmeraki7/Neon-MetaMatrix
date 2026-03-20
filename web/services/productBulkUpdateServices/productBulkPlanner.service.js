import crypto from "crypto";
import { buildProductPrismaWhere } from "../../services/product/productFilterCompiler.service.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
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

function normalizeProductForEdit(rawProduct) {
  return {
    ...rawProduct,
    options: Array.isArray(rawProduct?.options)
      ? rawProduct.options
      : Array.isArray(rawProduct?.optionsJson)
        ? rawProduct.optionsJson
        : [],
    variants: Array.isArray(rawProduct?.variants)
      ? rawProduct.variants.map((variant) => ({
          ...variant,
          selectedOptions: Array.isArray(variant?.selectedOptions)
            ? variant.selectedOptions
            : Array.isArray(variant?.selectedOptionsJson)
              ? variant.selectedOptionsJson
              : [],
        }))
      : [],
  };
}

export class ProductBulkPlannerService {
  constructor(session, repository) {
    this.session = session;
    this.repository = repository;
  }

  async buildBulkEditHistoryPayload(body, subscription = {}) {
    const {
      editedType,
      editedField,
      filterParams,
      value,
      searchKey,
      replaceText,
      supportValue,
      locationId,
    } = body || {};

    if (editedField === "inventory" && !locationId) {
      throw new Error("Location ID is required for inventory edits");
    }

    // ✅ NEW FILTER LOGIC
    const where = buildProductPrismaWhere(
      filterParams ?? [],
      this.session.shop,
    );

    const count = await this.repository.countProducts(where);

    const limit = subscription?.limit || 100;
    const planName = subscription?.planName || "Free Plan";
    const isUnlimited = subscription?.isUnlimited || false;

    if (!isUnlimited && count > limit) {
      throw new Error(
        `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${count} products. Please upgrade your plan or reduce the number of products.`,
      );
    }

    const updatedTitle = getUpdatedProducts({
      field: editedField,
      editType: editedType,
      value,
      supportValue,
      searchKey,
      replaceText,
      returnTitleOnly: true,
    });

    const multiLanguageTitle = await createMultiLanguage(updatedTitle);

    return {
      shop: this.session.shop,
      title: multiLanguageTitle,
      queryFilter: JSON.stringify(where),
      rules: [
        {
          field: editedField,
          value,
          editOption: editedType,
          searchKey,
          replaceText,
          supportValue,
        },
      ],
      startedAt: new Date(),
      status: "pending",
      processedCount: 0,
      totalItems: count,
      durationMs: 0,
      ...(editedField === "inventory" ? { locationId } : {}),
      undo: {
        allowed: editedField !== "deleteProducts",
      },
    };
  }

  async prepareBulkOperationBatch({ historyId }) {
    const history = await this.repository.findEditHistoryBatchData({
      id: historyId,
      shop: this.session.shop,
    });

    if (!history) {
      throw new Error("Edit history not found");
    }

    const rule = Array.isArray(history.rules) ? history.rules[0] : null;
    if (!rule) {
      throw new Error("Edit rule not found");
    }

    let baseWhere = {};
    try {
      baseWhere = JSON.parse(history.queryFilter || "{}");
    } catch {
      throw new Error("Invalid history query filter");
    }

    const limit = history?.batch?.size || 75;
    const where = { ...baseWhere };

    if (history?.batch?.lastProductId) {
      where.id = {
        ...(typeof where.id === "object" && where.id !== null ? where.id : {}),
        gt: history.batch.lastProductId,
      };
    }

    const include = buildProductInclude(rule.field);

    const products = await this.repository.findProductsForBatch({
      where,
      include,
      take: limit,
    });

    const changes = [];
    const formattedProducts = [];
    let lastId = null;
    let count = 0;
    const batchId = crypto.randomUUID();

    for (const rawProduct of products) {
      const product = normalizeProductForEdit(rawProduct);

      const result = getUpdatedProducts({
        product,
        field: rule.field,
        editType: rule.editOption,
        value: rule.value,
        searchKey: rule.searchKey,
        replaceText: rule.replaceText,
        supportValue: rule.supportValue,
        changes,
        historyId,
        shop: this.session.shop,
        batchId,
      });

      if (result) {
        formattedProducts.push(result);
      }

      lastId = product.id;
      count += 1;
    }

    return {
      formattedProducts: formattedProducts.join("\n"),
      changes,
      lastProductId: lastId,
      hasMore: count === limit,
      batchId,
    };
  }
}