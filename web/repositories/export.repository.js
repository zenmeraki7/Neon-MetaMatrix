import { prisma } from "../config/database.js";

function normalizeShop(shop) {
  return typeof shop === "string" ? shop.trim() : "";
}

function normalizeFilename(filename) {
  return typeof filename === "string" ? filename.trim() : "";
}

function normalizeJsonValue(value, fallback = {}) {
  if (value === undefined) {
    return fallback;
  }

  return value;
}


function normalizeStatus(status, fallback = "PENDING") {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  return normalized || fallback;
}

function normalizeDuration(duration, fallback = "Not completed yet.") {
  if (typeof duration === "string" && duration.trim()) {
    return duration.trim();
  }

  return fallback;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = Number.parseInt(value, 10);
  return Number.isNaN(normalized) ? null : normalized;
}

export class ExportRepository {
  async createExportHistory(data) {
    return prisma.exportHistory.create({
      data: {
        shop: normalizeShop(data?.shop),
        filename: normalizeFilename(data?.filename),
        filters: normalizeJsonValue(data?.filters, []),
        exportedData: normalizeNullableString(data?.exportedData),
        status: normalizeStatus(data?.status, "PENDING"),
        duration: normalizeDuration(data?.duration),
        totalItems: normalizeNullableInt(data?.totalItems),
        errorMessage: normalizeNullableString(data?.errorMessage),
        exportTime: data?.exportTime ?? null,
        type: normalizeNullableString(data?.type) || "Manual export",
        isFavourite: Boolean(data?.isFavourite),
        scheduledTask: normalizeNullableString(data?.scheduledTask),
      },
    });
  }

  async createExportJob(data) {
    return prisma.exportJob.create({
      data: {
        shop: normalizeShop(data?.shop),
        filterQuery:
          typeof data?.filterQuery === "string" && data.filterQuery.trim()
            ? data.filterQuery
            : "{}",
        filename: normalizeFilename(data?.filename),
        fields: Array.isArray(data?.fields)
          ? data.fields
              .map((field) => (typeof field === "string" ? field.trim() : ""))
              .filter(Boolean)
          : [],
        status: normalizeStatus(data?.status, "PENDING"),
        fileUrl: normalizeNullableString(data?.fileUrl),
        type: normalizeNullableString(data?.type) || "Manual export",
        totalItems: normalizeNullableInt(data?.totalItems),
        durationMs: normalizeNullableInt(data?.durationMs),
        startedAt: data?.startedAt ?? null,
        completedAt: data?.completedAt ?? null,
        error: normalizeNullableString(data?.error),
      },
    });
  }

  async findExportHistoryByIdAndShop({ id, shop }) {
    return prisma.exportHistory.findFirst({
      where: {
        id,
        shop: normalizeShop(shop),
      },
    });
  }

  async findExportJobByIdAndShop({ id, shop }) {
    return prisma.exportJob.findFirst({
      where: {
        id,
        shop: normalizeShop(shop),
      },
    });
  }

  async markExportHistoryCompleted({
    id,
    shop,
    exportedData,
    totalItems,
    duration,
    exportTime = new Date(),
    errorMessage = null,
  }) {
    return prisma.exportHistory.updateMany({
      where: {
        id,
        shop: normalizeShop(shop),
      },
      data: {
        status: "COMPLETED",
        exportedData: normalizeNullableString(exportedData),
        totalItems: normalizeNullableInt(totalItems),
        duration: normalizeDuration(duration, "0"),
        exportTime,
        errorMessage: normalizeNullableString(errorMessage),
      },
    });
  }

  async markExportHistoryFailed({
    id,
    shop,
    errorMessage,
    duration = "Failed",
  }) {
    return prisma.exportHistory.updateMany({
      where: {
        id,
        shop: normalizeShop(shop),
      },
      data: {
        status: "FAILED",
        errorMessage: normalizeNullableString(errorMessage),
        duration: normalizeDuration(duration, "Failed"),
      },
    });
  }

  async markExportJobStarted({
    id,
    shop,
    startedAt = new Date(),
  }) {
    return prisma.exportJob.updateMany({
      where: {
        id,
        shop: normalizeShop(shop),
      },
      data: {
        status: "PROCESSING",
        startedAt,
        error: null,
      },
    });
  }

  async markExportJobCompleted({
    id,
    shop,
    fileUrl,
    totalItems,
    durationMs,
    completedAt = new Date(),
  }) {
    return prisma.exportJob.updateMany({
      where: {
        id,
        shop: normalizeShop(shop),
      },
      data: {
        status: "COMPLETED",
        fileUrl: normalizeNullableString(fileUrl),
        totalItems: normalizeNullableInt(totalItems),
        durationMs: normalizeNullableInt(durationMs),
        completedAt,
        error: null,
      },
    });
  }

  async markExportJobFailed({
    id,
    shop,
    error,
    durationMs,
    completedAt = new Date(),
  }) {
    return prisma.exportJob.updateMany({
      where: {
        id,
        shop: normalizeShop(shop),
      },
      data: {
        status: "FAILED",
        error: normalizeNullableString(error),
        durationMs: normalizeNullableInt(durationMs),
        completedAt,
      },
    });
  }

  async findExportHistoryByShop({ shop }) {
  return prisma.exportHistory.findMany({
    where: {
      shop: {
        equals: shop,
        mode: "insensitive", // 🔥 IMPORTANT FIX
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

}

export const exportRepository = new ExportRepository();