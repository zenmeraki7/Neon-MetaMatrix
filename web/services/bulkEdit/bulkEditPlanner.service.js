// ============================================
// productBulkEdit.service.js (FINAL CLEAN)
// ============================================

import { buildProductPrismaWhere } from "../product/productFilterCompiler.service.js"; // ✅ NEW

import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";

import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { productRepository } from "../../repositories/product.repository.js";

import { enforceBulkEditLimit } from "../subscription/subscriptionGuard.service.js";
import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import { cacheKeys } from "../../cache/cacheKeys.js";

// ============================================
// HELPERS
// ============================================

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

// ============================================
// BUILD HISTORY PAYLOAD
// ============================================

export async function buildBulkEditHistoryPayload({
  body,
  shop,
  subscription = {},
}) {
  const safeBody = body && typeof body === "object" ? body : {};
  const normalizedShop = normalizeShop(shop);

  const {
    editedField,
    editedType,
    filterParams,
    value,
    searchKey,
    replaceText,
    supportValue,
    locationId,
  } = safeBody;

  const normalizedEditedField = normalizeString(editedField);
  const normalizedLocationId = normalizeString(locationId);

  // 🔴 Validation
  if (normalizedEditedField === "inventory" && !normalizedLocationId) {
    const error = new Error("Location ID is required for inventory edits");
    error.statusCode = 400;
    throw error;
  }

  // ✅ NEW FILTER BUILDER
  const where = buildProductPrismaWhere(
    filterParams ?? [],
    normalizedShop,
  );

  const count = await productRepository.countByWhere(where);

  // 🔒 Plan limit check
  enforceBulkEditLimit({
    count,
    subscription,
  });

  // 🧠 Title builder
  const updatedTitle = getUpdatedProducts({
    field: normalizedEditedField,
    editType: editedType,
    value,
    supportValue,
    searchKey,
    replaceText,
    returnTitleOnly: true,
  });

  const multiLanguageTitle = await createMultiLanguage(updatedTitle);

  return {
    shop: normalizedShop,
    title: multiLanguageTitle,
    queryFilter: JSON.stringify(where),
    rules: [
      {
        field: normalizedEditedField,
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

    ...(normalizedEditedField === "inventory"
      ? { locationId: normalizedLocationId }
      : {}),

    undo: {
      allowed: normalizedEditedField !== "deleteProducts",
    },
  };
}

// ============================================
// CREATE HISTORY + QUEUE
// ============================================

export async function createBulkEditHistoryAndQueue({
  body,
  shop,
  subscription = {},
  session,
}) {
  const normalizedShop = normalizeShop(shop);

  const historyPayload = await buildBulkEditHistoryPayload({
    body,
    shop: normalizedShop,
    subscription,
  });

  const history = await editHistoryRepository.createBulkEditHistory(
    historyPayload,
  );

  // 🧹 Cache clear
  await clearKeyCaches(cacheKeys.histories(normalizedShop));

  // 🚀 Queue job
  await addbulkEditJob({
    historyId: history.id,
    session,
  });

  return history;
}