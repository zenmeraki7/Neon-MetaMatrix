import shopify from "../../../shopify.js";
import axios from "axios";
import readline from "readline";


import { getSession } from "../../../utils/sessionHandler.js";
import { emitToUser } from "../../../socket.js";
import { clearKeyCaches } from "../../../utils/cacheUtils.js";

import { PrismaClient } from "../../../generated/prisma/index.js";

const prisma = new PrismaClient();

/* ────────────────────────────────────────────────────────────── */
/*  MAIN ENTRY: handleSyncOperation                              */
/* ────────────────────────────────────────────────────────────── */

export async function handleSyncOperation(bulkOperationId) {
  let syncHistory = null;

  try {
    syncHistory = await prisma.syncHistory.findFirst({
      where: { bulkOperationId },
    });

    if (!syncHistory) return;

    let recordCount = 0;

    const session = await getSession(syncHistory.shop);
    if (!session) {
      throw new Error(`No session found for shop ${syncHistory.shop}`);
    }

    const bulkOperation = await fetchBulkOperationDetails(
      session,
      bulkOperationId
    );

    if (!bulkOperation) throw new Error("Bulk operation not found");

    if (bulkOperation.errorCode) {
      throw new Error(
        `Shopify error: ${bulkOperation.errorCode}`
      );
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

    /* ───────────────────────── PRODUCT SYNC ───────────────────────── */

    if (syncHistory.operationType === "Product") {
      const result = await processProductStreamAndInsert({
        dataStream: urlResponse.data,
        shop: session.shop,
      });

      recordCount = result.totalProductsProcessed;

      await prisma.store.update({
        where: { shopUrl: session.shop },
        data: {
          isProductSyncing: false,
          isProductInitialySyning: false,
          shopifyBulkJobCompleted: true,
          lastProductSyncAt: new Date(),
          storeTotalProducts: result.totalProductsProcessed,
        },
      });

      emitToUser(session.shop, "product_sync", {
        message: "Product sync completed",
        totalProductsProcessed: result.totalProductsProcessed,
        totalVariantsProcessed: result.totalVariantsProcessed,
      });
    }

    /* ───────────────────────── COMMON CLEANUP ───────────────────────── */

    await clearKeyCaches(`${session.shop}:storeDetails`);
    await clearKeyCaches(`${session.shop}:sync_details`);
    await clearKeyCaches(`${session.shop}:ProductFetch`);

    const durationMs =
      new Date(bulkOperation.completedAt).getTime() -
      new Date(bulkOperation.createdAt).getTime();

    await prisma.syncHistory.update({
      where: { id: syncHistory.id },
      data: {
        status: "completed",
        responseUrl: bulkOperation.url,
        duration: Math.max(durationMs, 0),
        recordCount,
      },
    });

    return { message: "Sync completed" };
  } catch (err) {
    if (syncHistory) {
      await prisma.syncHistory.update({
        where: { id: syncHistory.id },
        data: { status: "failed" },
      }).catch(() => {});
    }

    if (syncHistory?.shop) {
      await prisma.store.update({
        where: { shopUrl: syncHistory.shop },
        data: {
          isProductSyncing: false,
          isProductInitialySyning: false,
        },
      }).catch(() => {});
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

/* ────────────────────────────────────────────────────────────── */
/*  STREAM PROCESSOR (REPLACES OLD productFilterService)         */
/* ────────────────────────────────────────────────────────────── */

async function processProductStreamAndInsert({ dataStream, shop }) {
  const BATCH_SIZE = 100;

  let productRows = [];
  let variantRows = [];

  let totalProductsProcessed = 0;
  let totalVariantsProcessed = 0;

  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  const flush = async () => {
    if (!productRows.length && !variantRows.length) return;

    await prisma.$transaction([
      prisma.product.createMany({
        data: productRows,
        skipDuplicates: true,
      }),
      prisma.variant.createMany({
        data: variantRows,
        skipDuplicates: true,
      }),
    ]);

    productRows = [];
    variantRows = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;

    const json = JSON.parse(line);

    if (json.__typename === "Product") {
      productRows.push({
        id: json.id,
        shop,
        title: json.title,
        productType: json.productType,
        vendor: json.vendor,
        status: json.status,
      });

      totalProductsProcessed++;
    }

    if (json.__typename === "ProductVariant") {
      variantRows.push({
        id: json.id,
        shop,
        productId: json.product?.id,
        price: json.price,
      });

      totalVariantsProcessed++;
    }

    if (
      productRows.length >= BATCH_SIZE ||
      variantRows.length >= BATCH_SIZE
    ) {
      await flush();
    }
  }

  await flush();

  return {
    totalProductsProcessed,
    totalVariantsProcessed,
  };
}