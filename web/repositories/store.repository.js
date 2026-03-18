import { prisma } from "../config/database.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

export const storeRepository = {
  async getSyncGateSnapshot(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      return null;
    }

    return prisma.store.findUnique({
      where: { shopUrl: normalizedShop },
      select: {
        isProductSyncing: true,
        isProductInitialySyning: true,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
        lastProductSyncAt: true,
      },
    });
  },

  async getSyncDetails(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      return null;
    }

    return prisma.store.findUnique({
      where: { shopUrl: normalizedShop },
      select: {
        isCollectionSyncing: true,
        lastCollectionSyncAt: true,
        isProductTypeSyncing: true,
        lastProductTypeSyncAt: true,
        isProductInitialySyning: true,
        productInitialSyncProgress: true,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
        isProductSyncing: true,
        lastProductSyncAt: true,
      },
    });
  },

  async getInitialSyncProgressSnapshot(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      return null;
    }

    return prisma.store.findUnique({
      where: { shopUrl: normalizedShop },
      select: {
        isProductInitialySyning: true,
        productInitialSyncProgress: true,
        shopifyBulkJobCompleted: true,
        storeTotalProducts: true,
      },
    });
  },
};