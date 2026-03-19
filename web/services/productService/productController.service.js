import fs from "fs/promises";
import shopify from "../../shopify.js";
import { Services } from "./productFilterService.js";
import UndoEditService from "./productBulkUndoService.js";
import ProductBulkService from "./productBulkEditService.js";
import { ProductExportService } from "./productExportService.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { addbulkExportJob } from "../../Jobs/Queues/bulkExportJob.js";
import { addbulkImportEditJob } from "../../Jobs/Queues/bulkImportEditJob.js";
import { scheduledEditQueue } from "../../Jobs/Queues/scheduledEditQueue.js";
import { clearAllCachesForShop, clearKeyCaches, getCache, setCache } from "../../utils/cacheUtils.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";
import { createMultiLanguage, createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { getUpdatedProducts } from "../../helpers/productBulkOperationHelpers/productUpdateHandler.js";
import { productRepository } from "../../repositories/product.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { exportRepository } from "../../repositories/export.repository.js";
import { filterTrackRepository } from "../../repositories/filterTrack.repository.js";
import { importRepository } from "../../repositories/import.repository.js";
import { syncRepository } from "../../repositories/sync.repository.js";

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

class ProductControllerService {
  constructor() {
    this.filterService = new Services();
  }

  async getProductsWithQuery({ shop, queryParams = {}, filterParams = [], nodeEnv }) {
    const result = await this.filterService.getProductsWithFilters({
      queryParams,
      filterParams,
      shop,
    });

    if (nodeEnv === "production") {
      await filterTrackRepository.create({
        shop,
        filterParams: filterParams || {},
        respondProductCount: result?.count || 0,
        type: "filter",
      });
    }

    return result;
  }

  async undoEdit({ session, historyId }) {
    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      throw createHttpError("Another operation is running in background", 400);
    }

    const service = new UndoEditService(session);
    return service.undoEdit(historyId);
  }

  async handleBulkEditProduct({ session, body, subscription }) {
    const { status } = await getCurrentBulkOperationStatus(session);

    if (status === "RUNNING") {
      throw createHttpError("Another operation is running in background", 400);
    }

    const service = new ProductBulkService(session);
    const result = await service.bulkEditProducts({
      body,
      subscription: subscription || {},
    });

    if (!result) {
      return null;
    }

    await clearAllCachesForShop(session.shop);

    return result;
  }

  async trackEditPreview({ session, body, lang, subscription, nodeEnv }) {
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
    } = body || {};

    if (nodeEnv === "production") {
      await filterTrackRepository.create({
        shop: session.shop,
        previewFilterParams: filterParams,
        type: "preview",
        field,
        editOption: editType,
        value: editValue,
        en: lang,
        searchKey,
        replaceText,
        supportValue,
      });
    }

    const service = new ProductBulkService(session);

    return service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams,
      searchKey,
      replaceText,
      supportValue,
      lang,
      page,
      limit,
      subscription: subscription || {},
    });
  }

  async checkEditStatus({ shop, historyId }) {
    return editHistoryRepository.findStatusMetricsByShopAndId({
      shop,
      id: historyId,
    });
  }

  async handleExportProductsData({ session, body }) {
    const { filterParams, fields, fileName } = body || {};

    const exportHistory = await exportRepository.createExportHistory({
      shop: session.shop,
      filename: fileName,
      filters: filterParams,
      status: "pending",
      duration: "Not completed yet.",
    });

    await clearKeyCaches(`${session.shop}:sync_details`);
    await clearKeyCaches(`${session.shop}:fetchExportHistories`);

    await addbulkExportJob({
      filterParams,
      session,
      columns: fields,
      filename: fileName,
      historyId: exportHistory.id,
    });

    return {
      message: "Exporting started — queued in background",
      data: exportHistory,
    };
  }

  async createProductExport({ session, body }) {
    const { fields, fileName, filterParams } = body || {};

    if (!Array.isArray(fields) || fields.length === 0) {
      throw createHttpError("No fields selected", 400);
    }

    if (!fileName?.trim()) {
      throw createHttpError("File name required", 400);
    }

    const shop = session.shop;
    const where = this.filterService.getProductPrismaWhere(filterParams, shop);
    const filename = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;

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

    return {
      exportJobId: exportJob.id,
      status: exportJob.status,
    };
  }

  async handleDownloadExportProductsData({ session, exportHistoryId }) {
    const service = new ProductExportService(session);
    const result = await service.getExportHistoryDetails(exportHistoryId);

    if (!result) {
      return null;
    }

    if (result.shop && result.shop !== session.shop) {
      throw createHttpError("Export history not found", 404);
    }

    return result;
  }

  async getProductTypes({ shop, search = "" }) {
    const normalizedSearch = String(search || "").toLowerCase();
    const cacheKey = `${shop}:productTypes:${normalizedSearch}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return {
        data: cached,
        message: "Product types fetched from cache",
      };
    }

    const productTypes = await productRepository.findDistinctProductTypes({
      shop,
      search,
      take: 20,
    });

    await setCache(cacheKey, productTypes, 300);

    return {
      data: productTypes,
      message: "Product types fetched from product mirror",
    };
  }

  async clearProductTypes({ session }) {
    const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
    if (status === "RUNNING") {
      throw createHttpError("Another operation is running in background", 400);
    }

    const client = new shopify.api.clients.Graphql({ session });

    const mutation = `mutation {
      bulkOperationRunQuery(
        query: """
          {
            products {
              edges {
                node {
                  id
                  productType
                }
              }
            }
          }
        """
      ) {
        bulkOperation {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`;

    const bulkResponse = await client.query({
      data: {
        query: mutation,
      },
    });

    if (bulkResponse?.body?.errors?.length) {
      throw new Error(bulkResponse.body.errors[0].message);
    }

    const userErrors =
      bulkResponse?.body?.data?.bulkOperationRunQuery?.userErrors || [];
    if (userErrors.length > 0) {
      throw new Error(userErrors[0]?.message || "Failed to start product type sync");
    }

    const bulkOperationId =
      bulkResponse?.body?.data?.bulkOperationRunQuery?.bulkOperation?.id;

    if (!bulkOperationId) {
      throw new Error("Failed to start product type sync");
    }

    await syncRepository.markProductTypeSyncing({
      shopUrl: session.shop,
      lastProductTypeSyncAt: new Date(),
    });

    await syncRepository.createSyncHistory({
      shop: session.shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: "ProductType",
    });

    await clearKeyCaches(`${session.shop}:sync_details`);

    return {
      message: "productType syncing started",
      operationId: bulkOperationId,
    };
  }

  async csvBulkProductsEdit({ session, file, body }) {
    if (!file) {
      throw createHttpError("CSV file is required", 400);
    }

    let columnMappings = {};
    try {
      columnMappings = body?.columnMappings
        ? JSON.parse(body.columnMappings)
        : {};
    } catch {
      await safeUnlink(file.path);
      throw createHttpError("Invalid columnMappings JSON", 400);
    }

    if (!Object.values(columnMappings).includes("id")) {
      await safeUnlink(file.path);
      throw createHttpError("Product ID mapping is required", 400);
    }

    const { status } = await getCurrentBulkOperationStatus(session);
    if (status === "RUNNING") {
      await safeUnlink(file.path);
      throw createHttpError("Another bulk operation is already running", 400);
    }

    const importHistory = await importRepository.createSpreadsheetFile({
      shop: session.shop,
      fileUrl: null,
      columnMappings,
      totalRows: 0,
    });

    await addbulkImportEditJob({
      session,
      filePath: file.path,
      importHistoryId: importHistory.id,
    });

    await clearAllCachesForShop(session.shop);

    return {
      success: true,
      message: "CSV import queued successfully",
      data: importHistory,
    };
  }

  async importCsvController({ session, file, body }) {
    if (!file) {
      throw createHttpError("CSV file required", 400);
    }

    if (!body?.columnMappings) {
      await safeUnlink(file.path);
      throw createHttpError("columnMappings missing", 400);
    }

    let parsedMappings;
    try {
      parsedMappings = JSON.parse(body.columnMappings);
    } catch {
      await safeUnlink(file.path);
      throw createHttpError("Invalid columnMappings JSON", 400);
    }

    const shop = session.shop;

    try {
      const fileUrl = await uploadCsvToCloudinary(file.path, "124673");

      const importDoc = await importRepository.createSpreadsheetFile({
        shop,
        columnMappings: parsedMappings,
        fileUrl,
        totalRows: null,
      });

      const multiTitle = createMultiLanguageForFileEdit(file.originalname);

      const editHistory = await editHistoryRepository.create({
        shop,
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

      await clearKeyCaches(`${shop}:fetchHistories`);

      await addbulkImportEditJob({
        historyId: editHistory.id,
        fileUrl,
        columnMappings: parsedMappings,
        session,
      });

      return {
        success: true,
        importId: editHistory.id,
      };
    } finally {
      await safeUnlink(file.path);
    }
  }

  async createScheduledEdit({ session, body, subscription }) {
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
    } = body || {};

    if (!filterParams || !editedField) {
      throw createHttpError("Missing required fields", 400);
    }

    const scheduledAt = new Date(rawScheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw createHttpError("Invalid scheduledAt", 400);
    }

    let scheduledUndoAt = null;
    if (rawScheduledUndoAt) {
      const undoDate = new Date(rawScheduledUndoAt);
      if (Number.isNaN(undoDate.getTime())) {
        throw createHttpError("Invalid scheduledUndoAt", 400);
      }
      scheduledUndoAt = undoDate;
    }

    if (editedField === "deleteProducts" && scheduledUndoAt) {
      throw createHttpError("Undo is not allowed for product deletion", 400);
    }

    const where = this.filterService.getProductPrismaWhere(filterParams, session.shop);
    const count = await productRepository.countByWhere(where);

    const planKey = subscription?.planKey;
    if (!planKey) {
      throw createHttpError("Subscription not found", 403);
    }

    let scheduledLimit = 0;
    if (planKey === "ADVANCED_MONTHLY") {
      scheduledLimit = 1000;
    } else if (planKey === "PRO_MONTHLY") {
      scheduledLimit = Infinity;
    }

    if (scheduledLimit !== Infinity && count > scheduledLimit) {
      const error = createHttpError(
        `Your plan allows scheduling edits for only ${scheduledLimit} products at a time. You selected ${count}. Please refine your filters or upgrade to Pro.`,
        403,
      );
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
    const delay = scheduledAt.getTime() - Date.now();

    if (delay <= 0) {
      throw createHttpError("Scheduled time must be in the future", 400);
    }

    const history = await editHistoryRepository.create({
      shop: session.shop,
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

    if (scheduledUndoAt && scheduledUndoAt.getTime() > Date.now() && undoAllowed) {
      const undoDelay = scheduledUndoAt.getTime() - Date.now();
      if (undoDelay > 0) {
        await scheduledEditQueue.add(
          "undo-task",
          { historyId: history.id },
          { delay: undoDelay, jobId: `undo-${history.id}` },
        );
      }
    }

    return {
      message: "Scheduled successfully",
      history,
    };
  }
}

export const productControllerService = new ProductControllerService();