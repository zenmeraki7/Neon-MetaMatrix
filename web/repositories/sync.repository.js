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

  async markProductTypeSyncCompleted({ shopUrl, lastProductTypeSyncAt }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductTypeSyncing: false,
        lastProductTypeSyncAt,
      },
    });
  }

  async markProductTypeSyncFailed({ shopUrl }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductTypeSyncing: false,
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

  async markCollectionSyncCompleted({ shopUrl, lastCollectionSyncAt }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isCollectionSyncing: false,
        lastCollectionSyncAt,
      },
    });
  }

  async markCollectionSyncFailed({ shopUrl }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isCollectionSyncing: false,
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

  async markProductSyncCompleted({
    shopUrl,
    lastProductSyncAt,
    storeTotalProducts = 0,
  }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductSyncing: false,
        isProductInitialySyning: false,
        shopifyBulkJobCompleted: true,
        lastProductSyncAt,
        storeTotalProducts,
      },
    });
  }

  async markProductSyncFailed({ shopUrl }) {
    return prisma.store.update({
      where: { shopUrl },
      data: {
        isProductSyncing: false,
        isProductInitialySyning: false,
      },
    });
  }

  async updateProductInitialSyncProgress({
    shopUrl,
    productInitialSyncProgress,
  }) {
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

  async markSyncHistoryCompleted({
    id,
    responseUrl,
    duration,
    recordCount,
  }) {
    return prisma.syncHistory.update({
      where: { id },
      data: {
        status: "completed",
        responseUrl,
        duration,
        recordCount,
      },
    });
  }

  async markSyncHistoryFailed({ id }) {
    return prisma.syncHistory.update({
      where: { id },
      data: {
        status: "failed",
      },
    });
  }
}

export const syncRepository = new SyncRepository();