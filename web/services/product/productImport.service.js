// web/services/product/productImport.service.js
import fs from "fs/promises";
import { addbulkImportEditJob } from "../../Jobs/Queues/bulkImportEditJob.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import { importRepository } from "../../repositories/import.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import {
  clearAllCachesForShop,
  clearKeyCaches,
} from "../../utils/cacheUtils.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { shopOperationLockService } from "../shared/shopOperationLock.service.js";

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function safeUnlink(filePath) {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
  } catch {
    // best-effort cleanup
  }
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

function ensureValidSession(session) {
  const normalizedSession = normalizeSession(session);
  const shop = normalizeShop(normalizedSession);

  if (!normalizedSession || !shop) {
    throw createHttpError("Shopify session missing", 401);
  }

  return normalizedSession;
}

function ensureFilePresent(file, message = "CSV file is required") {
  if (!file) {
    throw createHttpError(message, 400);
  }
}

function parseColumnMappings(rawValue, missingMessage, invalidMessage) {
  if (!rawValue) {
    throw createHttpError(missingMessage, 400);
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid parsed value");
    }
    return parsed;
  } catch {
    throw createHttpError(invalidMessage, 400);
  }
}

function hasRequiredProductIdMapping(columnMappings) {
  return Object.values(columnMappings).includes("id");
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

async function assertNoRunningBulkOperation(session) {
  const { status } = await getCurrentBulkOperationStatus(session);

  if (status === "RUNNING") {
    throw createHttpError("Another bulk operation is already running", 400);
  }
}

export class ProductImportService {
  async csvBulkProductsEdit({ session, file, body }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);

    ensureFilePresent(file, "CSV file is required");

    let columnMappings;

    try {
      columnMappings = parseColumnMappings(
        normalizedBody.columnMappings,
        "columnMappings missing",
        "Invalid columnMappings JSON",
      );
    } catch (err) {
      await safeUnlink(file.path);
      throw err;
    }

    if (!hasRequiredProductIdMapping(columnMappings)) {
      await safeUnlink(file.path);
      throw createHttpError("Product ID mapping is required", 400);
    }

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "import_csv",
      idempotencyKey: extractIdempotencyKey(normalizedBody),
      payload: {
        mode: "csvBulkProductsEdit",
        originalname: file?.originalname ?? null,
        size: file?.size ?? null,
        columnMappings,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      await safeUnlink(file.path);
      return lock.result;
    }

    try {
      await assertNoRunningBulkOperation(normalizedSession);

      const importHistory = await importRepository.createSpreadsheetFile({
        shop: normalizedSession.shop,
        fileUrl: null,
        columnMappings,
        totalRows: 0,
      });

      await addbulkImportEditJob({
        session: normalizedSession,
        filePath: file.path,
        importHistoryId: importHistory.id,
      });

      await clearAllCachesForShop(normalizedSession.shop);

      const result = {
        success: true,
        message: "CSV import queued successfully",
        data: importHistory,
      };

      await shopOperationLockService.completeOperation({
        shop: normalizedSession.shop,
        scope: "import_csv",
        token: lock.token,
        result,
        replayTtlSeconds: 3600,
      });

      return result;
    } catch (err) {
      await safeUnlink(file.path);
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "import_csv",
        token: lock.token,
      });
      throw err;
    }
  }

  async importCsvController({ session, file, body }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);

    ensureFilePresent(file, "CSV file required");

    let parsedMappings;

    try {
      parsedMappings = parseColumnMappings(
        normalizedBody.columnMappings,
        "columnMappings missing",
        "Invalid columnMappings JSON",
      );
    } catch (err) {
      await safeUnlink(file.path);
      throw err;
    }

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "import_csv_upload",
      idempotencyKey: extractIdempotencyKey(normalizedBody),
      payload: {
        mode: "importCsvController",
        originalname: file?.originalname ?? null,
        size: file?.size ?? null,
        columnMappings: parsedMappings,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      await safeUnlink(file.path);
      return lock.result;
    }

    try {
      const fileUrl = await uploadCsvToCloudinary(file.path, "124673");

      const importDoc = await importRepository.createSpreadsheetFile({
        shop: normalizedSession.shop,
        columnMappings: parsedMappings,
        fileUrl,
        totalRows: null,
      });

      const multiTitle = createMultiLanguageForFileEdit(file.originalname);

      const createFn =
        typeof editHistoryRepository.create === "function"
          ? editHistoryRepository.create.bind(editHistoryRepository)
          : editHistoryRepository.createScheduledEdit.bind(editHistoryRepository);

      const editHistory = await createFn({
        shop: normalizedSession.shop,
        title: multiTitle,
        editedType: "mixed",
        startedAt: new Date(),
        importFileId: importDoc.id,
        batch: {
          lastProductId: null,
          hasMore: false,
          size: 0,
        },
      });

      await clearKeyCaches(`${normalizedSession.shop}:fetchHistories`);

      await addbulkImportEditJob({
        historyId: editHistory.id,
        fileUrl,
        columnMappings: parsedMappings,
        session: normalizedSession,
      });

      const result = {
        success: true,
        importId: editHistory.id,
      };

      await shopOperationLockService.completeOperation({
        shop: normalizedSession.shop,
        scope: "import_csv_upload",
        token: lock.token,
        result,
        replayTtlSeconds: 3600,
      });

      return result;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "import_csv_upload",
        token: lock.token,
      });
      throw err;
    } finally {
      await safeUnlink(file.path);
    }
  }
}

export const productImportService = new ProductImportService();