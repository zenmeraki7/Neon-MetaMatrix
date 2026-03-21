import shopify from "../../../shopify.js";
import axios from "axios";

import { prisma } from "../../../config/database.js";
import { getSession } from "../../../utils/sessionHandler.js";
import { emitToUser } from "../../../socket.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";
import { productSyncIngestService } from "../../../services/productService/productSyncIngest.service.js";
import { syncRepository } from "../../../repositories/sync.repository.js";

/* ────────────────────────────────────────────────────────────── */
/*  MAIN ENTRY: handleSyncOperation                              */
/* ────────────────────────────────────────────────────────────── */

export async function handleSyncOperation(bulkOperationId) {
  let syncHistory = null;

  try {
    syncHistory = await prisma.syncHistory.findFirst({
      where: { bulkOperationId },
    });

    if (!syncHistory) {
      return;
    }

    const session = await getSession(syncHistory.shop);
    if (!session) {
      throw new Error(`No session found for shop ${syncHistory.shop}`);
    }

    const bulkOperation = await fetchBulkOperationDetails(
      session,
      bulkOperationId,
    );

    if (!bulkOperation) {
      throw new Error("Bulk operation not found");
    }

    if (bulkOperation.errorCode) {
      throw new Error(`Shopify error: ${bulkOperation.errorCode}`);
    }

    if (bulkOperation.status !== "COMPLETED") {
      throw new Error(`Bulk not completed: ${bulkOperation.status}`);
    }

    if (!bulkOperation.url) {
      throw new Error("Missing result URL");
    }

    const urlResponse = await axios.get(bulkOperation.url, {
      headers: { Accept: "application/json" },
      responseType: "stream",
    });

    let recordCount = 0;

    if (syncHistory.operationType === "Product") {
      const result = await productSyncIngestService.formatAndSyncProductsToDB({
        dataStream: urlResponse.data,
        shop: session.shop,
        replaceShopData: true,
      });

      recordCount = Number(result?.totalProductsProcessed || 0);

      await syncRepository.markProductSyncCompleted({
        shopUrl: session.shop,
        lastProductSyncAt: new Date(),
        storeTotalProducts: recordCount,
      });

      emitToUser(session.shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: result.totalProductsProcessed,
        totalVariantsProcessed: result.totalVariantsProcessed,
      });
    } else if (syncHistory.operationType === "ProductType") {
      await syncRepository.markProductTypeSyncCompleted({
        shopUrl: session.shop,
        lastProductTypeSyncAt: new Date(),
      });

      emitToUser(session.shop, "product_type_sync", {
        message: "Product type sync completed",
      });
    } else if (syncHistory.operationType === "Collection") {
      await syncRepository.markCollectionSyncCompleted({
        shopUrl: session.shop,
        lastCollectionSyncAt: new Date(),
      });

      emitToUser(session.shop, "collection_sync", {
        message: "Collection sync completed",
      });
    }

    const durationMs =
      new Date(bulkOperation.completedAt).getTime() -
      new Date(bulkOperation.createdAt).getTime();

    await syncRepository.markSyncHistoryCompleted({
      id: syncHistory.id,
      responseUrl: bulkOperation.url,
      duration: Math.max(durationMs, 0),
      recordCount,
    });

    await clearKeyCaches(`${session.shop}:storeDetails`);
    await clearKeyCaches(`${session.shop}:sync_details`);
    await clearKeyCaches(`${session.shop}:ProductFetch`);

    return { message: "Sync completed" };
  } catch (err) {
    if (syncHistory?.id) {
      await syncRepository.markSyncHistoryFailed({
        id: syncHistory.id,
      }).catch(() => {});
    }

    if (syncHistory?.shop) {
      if (syncHistory.operationType === "Product") {
        await syncRepository.markProductSyncFailed({
          shopUrl: syncHistory.shop,
        }).catch(() => {});
      } else if (syncHistory.operationType === "ProductType") {
        await syncRepository.markProductTypeSyncFailed({
          shopUrl: syncHistory.shop,
        }).catch(() => {});
      } else if (syncHistory.operationType === "Collection") {
        await syncRepository.markCollectionSyncFailed({
          shopUrl: syncHistory.shop,
        }).catch(() => {});
      }
    }

    throw err;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  BULK OP FETCH                                                */
/* ────────────────────────────────────────────────────────────── */

async function fetchBulkOperationDetails(session, bulkOperationId) {
  const client = new shopify.api.clients.Graphql({ session });

  const response = await client.query({
    data: {
      query: `
        query ($id: ID!) {
          node(id: $id) {
            ... on BulkOperation {
              id
              status
              errorCode
              url
              completedAt
              createdAt
            }
          }
        }
      `,
      variables: { id: bulkOperationId },
    },
  });

  return response.body?.data?.node;
}