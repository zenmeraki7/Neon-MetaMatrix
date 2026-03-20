// web/services/product/productExport.service.js
import { ProductExportService } from "../productService/productExportService.js";
import { exportRepository } from "../../repositories/export.repository.js";
import { addbulkExportJob } from "../../Jobs/Queues/bulkExportJob.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { buildProductPrismaWhere } from "./productFilterCompiler.service.js";
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

function normalizeFields(fields) {
  return Array.isArray(fields) ? fields.filter(Boolean) : [];
}

function normalizeFileName(fileName) {
  return typeof fileName === "string" ? fileName.trim() : "";
}

function normalizeFilterParams(filterParams) {
  return Array.isArray(filterParams) ? filterParams : [];
}

function ensureValidSession(session) {
  const normalizedSession = normalizeSession(session);
  const shop = normalizeShop(normalizedSession);

  if (!normalizedSession || !shop) {
    throw createHttpError("Shopify session missing", 401);
  }

  return normalizedSession;
}

function ensureValidExportFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw createHttpError("No fields selected", 400);
  }
}

function ensureValidFileName(fileName) {
  if (!fileName) {
    throw createHttpError("File name required", 400);
  }
}

function ensureCsvFileName(fileName) {
  return fileName.toLowerCase().endsWith(".csv") ? fileName : `${fileName}.csv`;
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

export class ProductExportServiceFacade {
  async handleExportProductsData({ session, body }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);

    const filterParams = normalizeFilterParams(normalizedBody.filterParams);
    const fields = normalizeFields(normalizedBody.fields);
    const fileName = normalizeFileName(normalizedBody.fileName);

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "export_job",
      idempotencyKey: extractIdempotencyKey(normalizedBody),
      payload: {
        mode: "handleExportProductsData",
        filterParams,
        fields,
        fileName,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      return lock.result;
    }

    try {
      const exportHistory = await exportRepository.createExportHistory({
        shop: normalizedSession.shop,
        filename: fileName,
        filters: filterParams,
        status: "pending",
        duration: "Not completed yet.",
      });

      await clearKeyCaches(`${normalizedSession.shop}:sync_details`);
      await clearKeyCaches(`${normalizedSession.shop}:fetchExportHistories`);

      await addbulkExportJob({
        filterParams,
        session: normalizedSession,
        columns: fields,
        filename: fileName,
        historyId: exportHistory.id,
      });

      const result = {
        message: "Exporting started — queued in background",
        data: exportHistory,
      };

      await shopOperationLockService.completeOperation({
        shop: normalizedSession.shop,
        scope: "export_job",
        token: lock.token,
        result,
        replayTtlSeconds: 3600,
      });

      return result;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "export_job",
        token: lock.token,
      });
      throw err;
    }
  }

  async createProductExport({ session, body }) {
    const normalizedSession = ensureValidSession(session);
    const normalizedBody = normalizeBody(body);

    const fields = normalizeFields(normalizedBody.fields);
    const rawFileName = normalizeFileName(normalizedBody.fileName);
    const filterParams = normalizeFilterParams(normalizedBody.filterParams);

    ensureValidExportFields(fields);
    ensureValidFileName(rawFileName);

    const lock = await shopOperationLockService.acquireOperation({
      shop: normalizedSession.shop,
      scope: "export_job_create",
      idempotencyKey: extractIdempotencyKey(normalizedBody),
      payload: {
        mode: "createProductExport",
        fields,
        rawFileName,
        filterParams,
      },
      lockTtlSeconds: 900,
      replayTtlSeconds: 3600,
    });

    if (lock.replay) {
      return lock.result;
    }

    try {
      const shop = normalizedSession.shop;
      const filename = ensureCsvFileName(rawFileName);
      const where = buildProductPrismaWhere(filterParams, shop);

      const exportJob = await exportRepository.createExportJob({
        shop,
        filename,
        fields,
        filterQuery: JSON.stringify(where),
        status: "PENDING",
      });

      await clearKeyCaches(`${shop}:fetchExportHistories:`);

      await addbulkExportJob({
        exportJobId: exportJob.id,
        shop,
        fields,
      });

      const result = {
        exportJobId: exportJob.id,
        status: exportJob.status,
      };

      await shopOperationLockService.completeOperation({
        shop,
        scope: "export_job_create",
        token: lock.token,
        result,
        replayTtlSeconds: 3600,
      });

      return result;
    } catch (err) {
      await shopOperationLockService.releaseOperation({
        shop: normalizedSession.shop,
        scope: "export_job_create",
        token: lock.token,
      });
      throw err;
    }
  }

  async handleDownloadExportProductsData({ session, exportHistoryId }) {
    const normalizedSession = ensureValidSession(session);

    if (!exportHistoryId) {
      throw createHttpError("Export history id is required", 400);
    }

    const exportReadService = new ProductExportService(normalizedSession);
    const result = await exportReadService.getExportHistoryDetails(exportHistoryId);

    if (!result) {
      return null;
    }

    if (result.shop && result.shop !== normalizedSession.shop) {
      throw createHttpError("Export history not found", 404);
    }

    return result;
  }
}

export const productExportService = new ProductExportServiceFacade();