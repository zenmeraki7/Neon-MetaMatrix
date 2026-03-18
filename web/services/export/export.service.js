import { Services } from "../../services/productService/productFilterService.js";
import { ProductExportService } from "../../services/productService/productExportService.js";
import { addbulkExportJob } from "../../Jobs/Queues/bulkExportJob.js";
import { exportRepository } from "../../repositories/export.repository.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";

const filterService = new Services();

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeFileName(fileName) {
  return String(fileName ?? "").trim();
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.filter((field) => field != null && String(field).trim() !== "");
}

function ensureCsvFilename(fileName) {
  const normalized = normalizeFileName(fileName);

  if (!normalized) {
    const error = new Error("File name required");
    error.statusCode = 400;
    throw error;
  }

  return normalized.toLowerCase().endsWith(".csv")
    ? normalized
    : `${normalized}.csv`;
}

export class ExportService {
  async startLegacyExport({ session, filterParams, fields, fileName }) {
    const shop = normalizeShop(session?.shop);
    const normalizedFileName = normalizeFileName(fileName);

    const exportHistory = await exportRepository.createLegacyExportHistory({
      shop,
      filename: normalizedFileName,
      filters: filterParams ?? {},
      status: "pending",
      duration: "Not completed yet.",
    });

    await clearKeyCaches(cacheKeys.syncDetails(shop));
    await clearKeyCaches(cacheKeys.exportHistories(shop));

    await addbulkExportJob({
      filterParams: filterParams ?? {},
      session,
      columns: fields,
      filename: normalizedFileName,
      historyId: exportHistory.id,
    });

    return exportHistory;
  }

  async createExportJob({ shop, fields, fileName, filterParams }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedFields = normalizeFields(fields);
    const filename = ensureCsvFilename(fileName);

    if (normalizedFields.length === 0) {
      const error = new Error("No fields selected");
      error.statusCode = 400;
      throw error;
    }

    const where = filterService.getProductPrismaWhere(
      filterParams ?? {},
      normalizedShop,
    );

    const job = await exportRepository.createExportJob({
      shop: normalizedShop,
      filename,
      fields: normalizedFields,
      filterQuery: JSON.stringify(where),
      status: "PENDING",
    });

    await clearKeyCaches(cacheKeys.exportHistoriesPrefix(normalizedShop));

    await addbulkExportJob({
      exportJobId: job.id,
      shop: normalizedShop,
      fields: normalizedFields,
    });

    return job;
  }

  async downloadLegacyExport({ session, id }) {
    const service = new ProductExportService(session);
    return service.getExportHistoryDetails(id);
  }
}

export const exportService = new ExportService();