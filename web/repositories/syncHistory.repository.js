import { prisma } from "../config/database.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

export const syncHistoryRepository = {
  async getLatestCompletedProductSync(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      return null;
    }

    return prisma.syncHistory.findFirst({
      where: {
        shop: normalizedShop,
        operationType: "Product",
        status: "completed",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        updatedAt: true,
        recordCount: true,
      },
    });
  },

  async getLatestInitialProductSync(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      return null;
    }

    return prisma.syncHistory.findFirst({
      where: {
        shop: normalizedShop,
        isInitialProductSync: true,
      },
      orderBy: { createdAt: "desc" },
      select: {
        bulkOperationId: true,
      },
    });
  },
};