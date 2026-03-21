import { Parser } from "json2csv";
import { fieldMappings } from "../../utils/productExportUtils.js";
import { EXPORT_TYPES } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";

// ✅ Use unified repository
import { exportRepository } from "../../repositories/export.repository.js";

function createHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export class ProductExportService {
  constructor(session) {
    this.session = session;
    this.fieldMappings = fieldMappings;
  }

  /* ======================================================
     CSV TRANSFORMATION (kept — still useful)
  ====================================================== */

  transformToCSV(products, requestedColumns) {
    const csvData = [];

    const getNestedValue = (obj, path, defaultValue = "") =>
      path.reduce(
        (acc, key) =>
          acc && acc[key] !== undefined && acc[key] !== null
            ? acc[key]
            : defaultValue,
        obj,
      );

    const safeSplitPop = (val) => (val ? val.toString().split("/").pop() : "");

    ensureArray(products).forEach((product) => {
      const variants = ensureArray(product?.variants);
      const images = ensureArray(product?.media);

      if (variants.length > 0) {
        variants.forEach((variant, index) => {
          const row = {};

          ensureArray(requestedColumns).forEach((column) => {
            const path = this.fieldMappings[column]?.split(".") || [];
            let value = "";

            if (path[0] === "variants") {
              value = getNestedValue(variant, path.slice(1));
            } else if (
              (path[0] === "images" || path[0] === "media") &&
              images.length > 0
            ) {
              value = getNestedValue(images[0], path.slice(1));
            } else {
              value = index === 0 ? getNestedValue(product, path) : "";
            }

            if (column === "ProductID") {
              value = index === 0 ? safeSplitPop(product?.id) : "";
            }

            if (column === "VariantID") {
              value = safeSplitPop(value);
            }

            row[column] =
              value !== null && value !== undefined ? value.toString() : "";
          });

          csvData.push(row);
        });
      } else {
        const row = {};

        ensureArray(requestedColumns).forEach((column) => {
          const path = this.fieldMappings[column]?.split(".") || [];

          let value =
            (path[0] === "images" || path[0] === "media") && images.length > 0
              ? getNestedValue(images[0], path.slice(1))
              : getNestedValue(product, path);

          if (column === "VariantID") {
            value = safeSplitPop(value);
          }

          if (column === "ProductID") {
            value = safeSplitPop(product?.id);
          }

          row[column] =
            value !== null && value !== undefined ? value.toString() : "";
        });

        csvData.push(row);
      }
    });

    const parser = new Parser({
      fields: ensureArray(requestedColumns),
    });

    return parser.parse(csvData);
  }

  /* ======================================================
     EXPORT HISTORY (aligned with new repository)
  ====================================================== */

  async getAllExportHistories(lang = "en") {
    const shop = this.session?.shop;

    if (!shop) {
      throw createHttpError("Shopify session missing", 401);
    }

    const cacheKey = `${shop}:fetchExportHistories:${lang}`;

    const cacheHistories = await getCache(cacheKey);
    if (cacheHistories) {
      return cacheHistories;
    }

    // ✅ Use ExportJob instead of legacy repo
  const histories = await exportRepository.findExportHistoryByShop
  ? await exportRepository.findExportHistoryByShop({ shop })
  : [];

    const formatted = histories.map((item) => ({
  id: item.id,
  filename: item.filename,
  status: item.status,
  totalItems: item.totalItems,
  duration: item.duration,
  createdAt: item.createdAt,
  type: EXPORT_TYPES[item.type]?.[lang] || item.type || "",
}));

    await setCache(cacheKey, formatted, 300);

    return formatted;
  }

  async getExportHistoryDetails(id) {
    const shop = this.session?.shop;

    if (!shop) {
      throw createHttpError("Shopify session missing", 401);
    }

    if (!id) {
      throw createHttpError("Export history id is required", 400);
    }

    // ✅ Use unified repository
    const job = await exportRepository.findExportJobByIdAndShop({
      id,
      shop,
    });

    if (!job) {
      throw createHttpError("Export history not found", 404);
    }

    return job;
  }
}