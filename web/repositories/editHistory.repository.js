import { prisma } from "../config/database.js";

function normalizeString(value) {
  return String(value ?? "").trim();
}

function assertCreatePayload(data, message) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
}

export const editHistoryRepository = {
  async getStatusMetricsByIdAndShop({ id, shop }) {
    const normalizedId = normalizeString(id);
    const normalizedShop = normalizeString(shop);

    if (!normalizedId || !normalizedShop) {
      return null;
    }

    return prisma.editHistory.findFirst({
      where: {
        id: normalizedId,
        shop: normalizedShop,
      },
      select: {
        processedCount: true,
        totalItems: true,
        durationMs: true,
      },
    });
  },

  async createScheduledEdit(data) {
    assertCreatePayload(data, "Invalid scheduled edit payload");
    return prisma.editHistory.create({ data });
  },

  async createBulkEditHistory(data) {
    assertCreatePayload(data, "Invalid bulk edit history payload");
    return prisma.editHistory.create({ data });
  },

  async getBulkExecutionState(historyId) {
    const normalizedHistoryId = normalizeString(historyId);

    if (!normalizedHistoryId) {
      return null;
    }

    return prisma.editHistory.findUnique({
      where: { id: normalizedHistoryId },
      select: {
        queryFilter: true,
        batch: true,
        rules: true,
      },
    });
  },
};