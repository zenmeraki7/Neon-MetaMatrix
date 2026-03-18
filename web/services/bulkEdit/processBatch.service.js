import crypto from "crypto";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { productRepository } from "../../repositories/product.repository.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { buildProductInclude } from "../../domain/productFields/fieldMeta.js";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeBatchSize(value, fallback = 75, max = 250) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function parseQueryFilter(rawQueryFilter) {
  if (!rawQueryFilter) {
    return {};
  }

  if (typeof rawQueryFilter === "object" && rawQueryFilter !== null) {
    return rawQueryFilter;
  }

  try {
    const parsed = JSON.parse(rawQueryFilter);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const error = new Error("Invalid edit history query filter");
      error.statusCode = 500;
      throw error;
    }

    return parsed;
  } catch (err) {
    if (err?.statusCode) {
      throw err;
    }

    const error = new Error("Invalid edit history query filter");
    error.statusCode = 500;
    throw error;
  }
}

function buildBatchWhere(baseWhere, lastProductId) {
  const where =
    baseWhere && typeof baseWhere === "object" && !Array.isArray(baseWhere)
      ? { ...baseWhere }
      : {};

  const normalizedLastProductId = normalizeString(lastProductId);

  if (normalizedLastProductId) {
    where.id = {
      ...(typeof where.id === "object" && where.id !== null ? where.id : {}),
      gt: normalizedLastProductId,
    };
  }

  return where;
}

function normalizeBatchProduct(rawProduct) {
  const safeProduct =
    rawProduct && typeof rawProduct === "object" ? rawProduct : {};

  return {
    ...safeProduct,
    variants: Array.isArray(safeProduct.variants) ? safeProduct.variants : [],
  };
}

export async function prepareBulkEditBatch({
  historyId,
  shop,
}) {
  const normalizedHistoryId = normalizeString(historyId);
  const normalizedShop = normalizeString(shop);

  if (!normalizedHistoryId) {
    const error = new Error("Edit history not found");
    error.statusCode = 404;
    throw error;
  }

  const history =
    await editHistoryRepository.getBulkExecutionState(normalizedHistoryId);

  if (!history) {
    const error = new Error("Edit history not found");
    error.statusCode = 404;
    throw error;
  }

  const rule = Array.isArray(history.rules) ? history.rules[0] : null;

  if (!rule || !normalizeString(rule.field)) {
    const error = new Error("Edit rule not found");
    error.statusCode = 500;
    throw error;
  }

  const baseWhere = parseQueryFilter(history.queryFilter);
  const limit = normalizeBatchSize(history.batch?.size, 75, 250);
  const where = buildBatchWhere(baseWhere, history.batch?.lastProductId);
  const include = buildProductInclude(rule.field);

  const products = await productRepository.findManyForBulkBatch({
    where,
    include,
    take: limit,
  });

  const changes = [];
  const formattedProducts = [];
  const batchId = crypto.randomUUID();
  let lastProductId = null;

  for (const rawProduct of products) {
    const product = normalizeBatchProduct(rawProduct);

    const result = getUpdatedProducts({
      product,
      field: rule.field,
      editType: rule.editOption,
      value: rule.value,
      searchKey: rule.searchKey,
      replaceText: rule.replaceText,
      supportValue: rule.supportValue,
      changes,
      historyId: normalizedHistoryId,
      shop: normalizedShop,
      batchId,
    });

    if (result) {
      formattedProducts.push(result);
    }

    lastProductId = product.id ?? lastProductId;
  }

  return {
    formattedProducts: formattedProducts.join("\n"),
    changes,
    lastProductId,
    hasMore: products.length === limit,
    batchId,
  };
}