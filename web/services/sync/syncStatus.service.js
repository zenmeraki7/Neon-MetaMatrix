import { getCache, setCache } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import { storeRepository } from "../../repositories/store.repository.js";

const SYNC_STATUS_TTL_SECONDS = 300;

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function isCacheableSyncDetails(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSyncDetails(store) {
  return {
    isCollectionSyncing: store.isCollectionSyncing,
    lastCollectionSyncAt: store.lastCollectionSyncAt,
    isProductTypeSyncing: store.isProductTypeSyncing,
    lastProductTypeSyncAt: store.lastProductTypeSyncAt,
    isProductInitialySyning: store.isProductInitialySyning,
    productInitialSyncProgress: store.productInitialSyncProgress,
    shopifyBulkJobCompleted: store.shopifyBulkJobCompleted,
    storeTotalProducts: store.storeTotalProducts,
    isProductSyncing: store.isProductSyncing,
    lastProductSyncAt: store.lastProductSyncAt,
  };
}

export class SyncStatusService {
  async getSyncStatus(shop) {
    const normalizedShop = normalizeShop(shop);

    if (!normalizedShop) {
      const error = new Error("Shop is required");
      error.statusCode = 400;
      throw error;
    }

    const cacheKey = cacheKeys.syncDetails(normalizedShop);
    const cached = await getCache(cacheKey);

    if (isCacheableSyncDetails(cached)) {
      return {
        fromCache: true,
        payload: {
          success: true,
          shop: normalizedShop,
          syncStatus: cached,
        },
      };
    }

    const store = await storeRepository.getSyncDetails(normalizedShop);

    if (!store) {
      const error = new Error("Store not found");
      error.statusCode = 404;
      error.payload = {
        error: "Store not found",
        success: false,
      };
      throw error;
    }

    const syncDetails = toSyncDetails(store);

    await setCache(cacheKey, syncDetails, SYNC_STATUS_TTL_SECONDS);

    return {
      fromCache: false,
      payload: {
        success: true,
        shop: normalizedShop,
        syncStatus: syncDetails,
      },
    };
  }
}

export const syncStatusService = new SyncStatusService();