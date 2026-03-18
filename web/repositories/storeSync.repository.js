import { prisma } from "../config/database.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

export const storeSyncRepository = {
  async markProductTypeSyncStarted({ shop }) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      const error = new Error("Shop is required");
      error.statusCode = 400;
      throw error;
    }

    return prisma.store.update({
      where: { shopUrl: normalizedShop },
      data: {
        isProductTypeSyncing: true,
        lastProductTypeSyncAt: new Date(),
      },
    });
  },

  async createSyncHistory(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      const error = new Error("Invalid sync history payload");
      error.statusCode = 400;
      throw error;
    }

    return prisma.syncHistory.create({ data });
  },
};