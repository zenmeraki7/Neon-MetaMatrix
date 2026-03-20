// web/services/scheduled/scheduledEdit.service.js
import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { scheduledEditQueue } from "../../Jobs/Queues/scheduledEditQueue.js";
import { productRepository } from "../../repositories/product.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { buildProductPrismaWhere } from "../product/productFilterCompiler.service.js";
import { shopOperationLockService } from "../shared/shopOperationLock.service.js";

function resolveScheduledLimit(planKey) {
  if (planKey === "ADVANCED_MONTHLY") return 1000;
  if (planKey === "PRO_MONTHLY") return Infinity;
  return 0;
}

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function createHttpError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function parseRequiredFutureDate(value, fieldName) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`Invalid ${fieldName}`, 400);
  }

  return date;
}

function parseOptionalDate(value, fieldName) {
  if (!value) return null;
  return parseRequiredFutureDate(value, fieldName);
}

function ensureValidSession(session) {
  const shop = normalizeShop(session?.shop);
  if (!shop) {
    throw createHttpError("Shopify session missing", 401);
  }
  return shop;
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

export class ScheduledEditService {
  async createScheduledEdit({ session, body, subscription }) {
    const safeBody = body && typeof body === "object" ? body : {};
    const shop = ensureValidSession(session);

    const {
      editedField,
      editedBy,
      filterParams,
      value,
      scheduledAt: rawScheduledAt,
      scheduledUndoAt: rawScheduledUndoAt,
      searchKey,
      replaceText,
      supportValue,
    } = safeBody;

    if (!filterParams || !editedField) {
      throw createHttpError("Missing required fields", 400);
    }

    const scheduledAt = parseRequiredFutureDate(rawScheduledAt, "scheduledAt");
    const scheduledUndoAt = parseOptionalDate(
      rawScheduledUndoAt,
      "scheduledUndoAt",
    );

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      throw createHttpError(
        "Undo is not allowed for product deletion",
        400,
      );
    }

    const delay = scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      throw createHttpError("Scheduled time must be in the future", 400);
    }

    if (scheduledUndoAt && scheduledUndoAt.getTime() <= scheduledAt.getTime()) {
      throw createHttpError(
        "scheduledUndoAt must be later than scheduledAt",
        400,
      );
    }

    const planKey = subscription?.planKey;

    if (!planKey) {
      throw createHttpError("Subscription not found", 403);
    }

    const lock = await shopOperationLockService.acquireOperation({
      shop,
      scope: "scheduled_edit",
      idempotencyKey: extractIdempotencyKey(safeBody),
      payload: {
        editedField,
        editedBy,
        filterParams,
        value,
        scheduledAt: rawScheduledAt,
        scheduledUndoAt: rawScheduledUndoAt,
        searchKey,
        replaceText,
        supportValue,
        planKey,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      return lock.result;
    }

    try {
      const where = buildProductPrismaWhere(filterParams, shop);

      const count = await productRepository.countByWhere(where);
      const scheduledLimit = resolveScheduledLimit(planKey);

      if (scheduledLimit !== Infinity && count > scheduledLimit) {
        throw createHttpError(
          `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
          403,
          "PRODUCT_LIMIT_EXCEEDED",
        );
      }

      const updatedTitle = getUpdatedProducts({
        field: editedField,
        editType: editedBy,
        value,
        returnTitleOnly: true,
        supportValue,
        searchKey,
        replaceText,
      });

      const multiLanguageTitle = await createMultiLanguage(updatedTitle);
      const undoAllowed = editedField !== "deleteProducts";

      const createFn =
        typeof editHistoryRepository.createScheduledEdit === "function"
          ? editHistoryRepository.createScheduledEdit.bind(editHistoryRepository)
          : editHistoryRepository.create.bind(editHistoryRepository);

      const history = await createFn({
        shop,
        title: multiLanguageTitle,
        status: "pending",
        processedCount: 0,
        totalItems: count,
        scheduledAt,
        scheduledUndoAt,
        type: "Scheduled edit",
        queryFilter: JSON.stringify(where),
        rules: [
          {
            field: editedField,
            value,
            editOption: editedBy,
            searchKey,
            replaceText,
            supportValue,
          },
        ],
        startedAt: new Date(),
        undo: {
          allowed: undoAllowed,
        },
      });

      await scheduledEditQueue.add(
        "scheduled-task",
        { historyId: history.id },
        { delay, jobId: `task-${history.id}` },
      );

      if (scheduledUndoAt && undoAllowed) {
        const undoDelay = scheduledUndoAt.getTime() - Date.now();

        if (undoDelay > 0) {
          await scheduledEditQueue.add(
            "undo-task",
            { historyId: history.id },
            { delay: undoDelay, jobId: `undo-${history.id}` },
          );
        }
      }

      await shopOperationLockService.completeOperation({
        shop,
        scope: "scheduled_edit",
        token: lock.token,
        result: history,
        replayTtlSeconds: 3600,
      });

      return history;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop,
        scope: "scheduled_edit",
        token: lock.token,
      });
      throw err;
    }
  }
}

export const scheduledEditService = new ScheduledEditService();