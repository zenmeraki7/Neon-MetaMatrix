// web/services/product/productBulkEdit.service.js
import ProductBulkService from "../productService/productBulkEditService.js";
import UndoEditService from "../productService/productBulkUndoService.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { clearAllCachesForShop } from "../../utils/cacheUtils.js";
import { filterTrackRepository } from "../../repositories/filterTrack.repository.js";
import { shopOperationLockService } from "../shared/shopOperationLock.service.js";

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeSession(session) {
  return session && typeof session === "object" ? session : null;
}

function normalizeShop(session) {
  return typeof session?.shop === "string" ? session.shop.trim() : "";
}

function normalizeBody(body) {
  return body && typeof body === "object" ? body : {};
}

function normalizeSubscription(subscription) {
  return subscription && typeof subscription === "object" ? subscription : {};
}

function normalizeLang(lang) {
  return typeof lang === "string" && lang.trim() ? lang.trim() : "en";
}

function isProductionEnvironment(environment) {
  return String(environment ?? "").trim().toLowerCase() === "production";
}

function ensureValidSession(session) {
  const normalizedSession = normalizeSession(session);
  const shop = normalizeShop(normalizedSession);

  if (!normalizedSession || !shop) {
    throw createHttpError("Shopify session missing", 401);
  }

  return normalizedSession;
}

function extractIdempotencyKey(body) {
  if (typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()) {
    return body.idempotencyKey.trim();
  }

  if (typeof body?.requestId === "string" && body.requestId.trim()) {
    return body.requestId.trim();
  }

  return null;
}

async function assertNoRunningBulkOperation(session, scope) {
  const { status } = await getCurrentBulkOperationStatus(session, scope);

  if (status === "RUNNING") {
    throw createHttpError("Another operation is running in background", 400);
  }
}

export class ProductBulkEditService {
  async handleBulkEditProduct({ session, body, subscription }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);
    const normalizedSubscription = normalizeSubscription(subscription);

    await assertNoRunningBulkOperation(normalizedSession);

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "bulk_edit",
      idempotencyKey: extractIdempotencyKey(normalizedBody),
      payload: {
        body: normalizedBody,
        planKey: normalizedSubscription?.planKey ?? null,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      return lock.result;
    }

    try {
      const service = new ProductBulkService(normalizedSession);
      const result = await service.bulkEditProducts({
        body: normalizedBody,
        subscription: normalizedSubscription,
      });

      if (!result) {
        await shopOperationLockService.releaseOperation({
          shop: normalizedSession.shop,
          scope: "bulk_edit",
          token: lock.token,
        });
        return null;
      }

      await clearAllCachesForShop(normalizedSession.shop);

      await shopOperationLockService.completeOperation({
        shop: normalizedSession.shop,
        scope: "bulk_edit",
        token: lock.token,
        result,
        replayTtlSeconds: 3600,
      });

      return result;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "bulk_edit",
        token: lock.token,
      });
      throw err;
    }
  }

  async trackEditPreview({ session, body, lang, subscription, environment }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);
    const normalizedSubscription = normalizeSubscription(subscription);
    const normalizedLang = normalizeLang(lang);

    const {
      field,
      editType,
      editValue,
      searchKey,
      replaceText,
      filterParams,
      supportValue,
      page,
      limit,
    } = normalizedBody;

    if (isProductionEnvironment(environment)) {
      if (typeof filterTrackRepository.create === "function") {
        await filterTrackRepository.create({
          shop: normalizedSession.shop,
          previewFilterParams: filterParams,
          type: "preview",
          field,
          editOption: editType,
          value: editValue,
          en: normalizedLang,
          searchKey,
          replaceText,
          supportValue,
        });
      } else if (typeof filterTrackRepository.createFilterTrack === "function") {
        await filterTrackRepository.createFilterTrack({
          shop: normalizedSession.shop,
          previewFilterParams: filterParams,
          type: "preview",
          field,
          editOption: editType,
          value: editValue,
          en: normalizedLang,
          searchKey,
          replaceText,
          supportValue,
        });
      }
    }

    const service = new ProductBulkService(normalizedSession);

    return service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams,
      searchKey,
      replaceText,
      supportValue,
      lang: normalizedLang,
      page,
      limit,
      subscription: normalizedSubscription,
    });
  }

  async undoEdit({ session, historyId }) {
    const normalizedSession = ensureValidSession(session);

    await assertNoRunningBulkOperation(normalizedSession);

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "bulk_edit_undo",
      idempotencyKey: historyId,
      payload: { historyId },
      lockTtlSeconds: 600,
      replayTtlSeconds: 1800,
    });

    if (lock.replay) {
      return lock.result;
    }

    try {
      const service = new UndoEditService(normalizedSession);
      const result = await service.undoEdit(historyId);

      await shopOperationLockService.completeOperation({
        shop: normalizedSession.shop,
        scope: "bulk_edit_undo",
        token: lock.token,
        result,
        replayTtlSeconds: 1800,
      });

      return result;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "bulk_edit_undo",
        token: lock.token,
      });
      throw err;
    }
  }
}

export const productBulkEditService = new ProductBulkEditService();