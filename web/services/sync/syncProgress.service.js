import { getBulkEditStatus } from "../../utils/bulkOperationHelper.js";
import { storeRepository } from "../../repositories/store.repository.js";
import { syncHistoryRepository } from "../../repositories/syncHistory.repository.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function toSafeNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampHalfProgress(processed, total) {
  const safeProcessed = toSafeNumber(processed);
  const safeTotal = toSafeNumber(total);

  if (safeTotal <= 0) {
    return 0;
  }

  const percentage = Number(((safeProcessed / safeTotal) * 100).toFixed(2));
  return Math.min(percentage, 100) / 2;
}

export class SyncProgressService {
  async getProductSyncProgress({ session }) {
    const shop = normalizeShop(session?.shop);

    const storeDetails =
      await storeRepository.getInitialSyncProgressSnapshot(shop);

    if (!storeDetails) {
      const error = new Error("Store not found");
      error.statusCode = 404;
      error.payload = {
        success: false,
        message: "Store not found",
      };
      throw error;
    }

    const {
      isProductInitialySyning,
      productInitialSyncProgress,
      shopifyBulkJobCompleted,
      storeTotalProducts,
    } = storeDetails;

    const totalProducts = toSafeNumber(storeTotalProducts);

    if (isProductInitialySyning === false) {
      return {
        success: true,
        message: "Product syncing completed.",
        status: "completed",
        totalProducts,
        processedProducts: totalProducts,
        progress: 100,
      };
    }

    if (!shopifyBulkJobCompleted) {
      const syncHistory =
        await syncHistoryRepository.getLatestInitialProductSync(shop);

      if (!syncHistory?.bulkOperationId) {
        return {
          success: true,
          message: "No initial product sync found",
          status: "idle",
          totalProducts,
          processedProducts: 0,
          progress: 0,
        };
      }

      const result = await getBulkEditStatus(
        syncHistory.bulkOperationId,
        session,
      );

      const shopifyBulkProgress = toSafeNumber(result?.rootObjectCount);
      const percentage = clampHalfProgress(shopifyBulkProgress, totalProducts);

      return {
        success: true,
        message: "Product Sync in progress...",
        status: "syncing",
        totalProducts,
        processedProducts: shopifyBulkProgress / 2,
        progress: percentage,
      };
    }

    const mirroredProgress = toSafeNumber(productInitialSyncProgress);
    const percentage = clampHalfProgress(mirroredProgress, totalProducts);

    return {
      success: true,
      message: "Product Sync in progress...",
      status: "syncing",
      totalProducts,
      processedProducts: totalProducts / 2 + mirroredProgress / 2,
      progress: percentage + 50,
    };
  }
}

export const syncProgressService = new SyncProgressService();