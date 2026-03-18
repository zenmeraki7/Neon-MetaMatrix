import { Services } from "../../services/productService/productFilterService.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import { storeRepository } from "../../repositories/store.repository.js";
import { syncHistoryRepository } from "../../repositories/syncHistory.repository.js";
import { productRepository } from "../../repositories/product.repository.js";

const legacyProductService = new Services();

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeForce(force) {
  if (typeof force === "boolean") {
    return force;
  }

  return String(force ?? "").trim().toLowerCase() === "true";
}

export class ProductSyncService {
  async startProductSync({ session, force }) {
    const shop = normalizeShop(session?.shop);
    const normalizedForce = normalizeForce(force);

    const [store, productCount, latestCompletedSync] = await Promise.all([
      storeRepository.getSyncGateSnapshot(shop),
      productRepository.countByWhere({ shop }),
      syncHistoryRepository.getLatestCompletedProductSync(shop),
    ]);

    const alreadySynced =
      !!store &&
      store.isProductSyncing === false &&
      store.isProductInitialySyning === false &&
      store.shopifyBulkJobCompleted === true &&
      productCount > 0;

    if (alreadySynced && !normalizedForce) {
      return {
        skipped: true,
        forced: false,
        response: {
          message: "Products already synced. Skipping new sync.",
          skipped: true,
          forceAllowed: true,
          data: {
            productCount,
            storeTotalProducts: store.storeTotalProducts,
            lastProductSyncAt: store.lastProductSyncAt,
            lastCompletedSyncAt: latestCompletedSync?.updatedAt || null,
            lastCompletedRecordCount: latestCompletedSync?.recordCount || null,
          },
        },
      };
    }

    const result = await legacyProductService.startBulkOperationToFetchProducts({
      session,
    });

    await clearKeyCaches(cacheKeys.syncDetails(shop));

    return {
      skipped: false,
      forced: normalizedForce,
      response: {
        ...result,
        skipped: false,
        forced: normalizedForce,
      },
    };
  }
}

export const productSyncService = new ProductSyncService();