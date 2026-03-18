import { translatedEditHistoryStatuses } from "../../Config/constants.js";
import UndoEditService from "../../services/productService/productBulkUndoService.js";
import ProductBulkService from "../../services/productService/productBulkEditService.js";
import { filterTrackRepository } from "../../repositories/filterTrack.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { clearAllCachesForShop } from "../../utils/cacheUtils.js";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function isProductionEnvironment(environment) {
  return String(environment ?? "").trim().toLowerCase() === "production";
}

function normalizeLanguage(lang) {
  const value = normalizeString(lang);
  return value || "en";
}

export class BulkEditService {
  async undoEdit({ session, id }) {
    const service = new UndoEditService(session);
    const result = await service.undoEdit(id);

    if (!result || typeof result !== "object") {
      const error = new Error("Undo edit failed — no result returned.");
      error.statusCode = 500;
      throw error;
    }

    return result.data;
  }

  async handleBulkEditProduct({ session, req }) {
    const service = new ProductBulkService(session);
    const lang = normalizeLanguage(req?.query?.lang);
    const subscription = req?.subscription;

    const result = await service.bulkEditProducts({
      ...req,
      subscription,
    });

    if (!result || typeof result !== "object") {
      const error = new Error("Bulk edit failed — no result returned.");
      error.statusCode = 500;
      throw error;
    }

    await clearAllCachesForShop(session.shop);

    const rawStatus = result.status;
    const translatedStatus =
      translatedEditHistoryStatuses?.[rawStatus]?.[lang] || rawStatus;

    return {
      id: result.id,
      title: result.title,
      status: translatedStatus,
      processedCount: result.processedCount,
      totalItems: result.totalItems,
      duration: result.durationMs,
      field: result.field,
      shop: session.shop,
    };
  }

  async trackEditPreview({ session, body, lang, subscription, environment }) {
    const safeBody = body && typeof body === "object" ? body : {};

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
    } = safeBody;

    const normalizedLang = normalizeLanguage(lang);

    if (isProductionEnvironment(environment)) {
      await filterTrackRepository.createFilterTrack({
        shop: session.shop,
        previewFilterParams: filterParams ?? {},
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

    const service = new ProductBulkService(session);

    return service.trackEditProducts({
      field,
      editType,
      editValue,
      filterParams: filterParams ?? {},
      searchKey,
      replaceText,
      supportValue,
      lang: normalizedLang,
      page,
      limit,
      subscription,
    });
  }

  async checkEditStatus({ shop, id }) {
    return editHistoryRepository.getStatusMetricsByIdAndShop({
      id: normalizeString(id),
      shop: normalizeString(shop),
    });
  }
}

export const bulkEditService = new BulkEditService();