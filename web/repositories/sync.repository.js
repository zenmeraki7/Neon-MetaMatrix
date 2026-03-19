import { prisma } from "../config/database.js";

class SyncRepository {
  async markProductTypeSyncing({ shopUrl, lastProductTypeSyncAt }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductTypeSyncing: true,
        lastProductTypeSyncAt,
      },
    });
  }

  async markCollectionSyncing({ shopUrl, lastCollectionSyncAt }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isCollectionSyncing: true,
        lastCollectionSyncAt,
      },
    });
  }

  async markProductSyncing({ shopUrl, lastProductSyncAt }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductSyncing: true,
        lastProductSyncAt,
      },
    });
  }

  async updateProductInitialSyncProgress({ shopUrl, productInitialSyncProgress }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        productInitialSyncProgress,
      },
    });
  }

  async createSyncHistory(data) {
    return prisma.syncHistory.create({ data });
  }
}

export const syncRepository = new SyncRepository();