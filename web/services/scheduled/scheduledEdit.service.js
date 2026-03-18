import { createMultiLanguage } from "../../utils/googleTranslator.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { scheduledEditQueue } from "../../Jobs/Queues/scheduledEditQueue.js";
import { productQueryService } from "../product/productQuery.service.js";
import { productRepository } from "../../repositories/product.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";

function resolveScheduledLimit(planKey) {
  if (planKey === "ADVANCED_MONTHLY") return 1000;
  if (planKey === "PRO_MONTHLY") return Infinity;
  return 0;
}

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function parseRequiredFutureDate(value, fieldName) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    const error = new Error(`Invalid ${fieldName}`);
    error.statusCode = 400;
    throw error;
  }

  return date;
}

function parseOptionalDate(value, fieldName) {
  if (!value) {
    return null;
  }

  return parseRequiredFutureDate(value, fieldName);
}

export class ScheduledEditService {
  async createScheduledEdit({ session, body, subscription }) {
    const safeBody = body && typeof body === "object" ? body : {};
    const shop = normalizeShop(session?.shop);

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
      const error = new Error("Missing required fields");
      error.statusCode = 400;
      throw error;
    }

    const scheduledAt = parseRequiredFutureDate(rawScheduledAt, "scheduledAt");
    const scheduledUndoAt = parseOptionalDate(
      rawScheduledUndoAt,
      "scheduledUndoAt",
    );

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      const error = new Error("Undo is not allowed for product deletion");
      error.statusCode = 400;
      throw error;
    }

    const delay = scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      const error = new Error("Scheduled time must be in the future");
      error.statusCode = 400;
      throw error;
    }

    if (scheduledUndoAt && scheduledUndoAt.getTime() <= scheduledAt.getTime()) {
      const error = new Error("scheduledUndoAt must be later than scheduledAt");
      error.statusCode = 400;
      throw error;
    }

    const planKey = subscription?.planKey;

    if (!planKey) {
      const error = new Error("Subscription not found");
      error.statusCode = 403;
      throw error;
    }

    const where = productQueryService.getProductPrismaWhere(
      filterParams,
      shop,
    );

    const count = await productRepository.countByWhere(where);
    const scheduledLimit = resolveScheduledLimit(planKey);

    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      const error = new Error(
        `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
      );
      error.statusCode = 403;
      error.code = "PRODUCT_LIMIT_EXCEEDED";
      throw error;
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

    const history = await editHistoryRepository.createScheduledEdit({
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

    return history;
  }
}

export const scheduledEditService = new ScheduledEditService();