import CacheService from "../utils/cacheService.js";

const BULK_EDIT_CACHE_TTL_SECONDS = 300;

function getProductUpdateKey(shop) {
  return `${shop}:PRODUCT_UPDATE`;
}

export const bulkEditCacheService = {
  async markProductUpdateRunning(shop) {
    if (!shop) return;

    const key = getProductUpdateKey(shop);

    await CacheService.set(
      key,
      {
        running: true,
        updatedAt: Date.now(),
      },
      BULK_EDIT_CACHE_TTL_SECONDS,
    );
  },
};