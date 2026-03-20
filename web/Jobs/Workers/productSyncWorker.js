// ============================================
// Jobs/Workers/productSyncWorker.js (FINAL CLEAN)
// ============================================

import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";

import { productSyncService } from "../../services/sync/productSync.service.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { productSyncQueue } from "../Queues/productSyncQueue.js";

import { prisma } from "../../config/database.js";
import shopify from "../../shopify.js";

import dotenv from "dotenv";
dotenv.config();

// ============================================
// SYNC ALL STORES IN BATCHES
// ============================================
async function syncAllStoresBatched() {
  const batchSize = 20;
  let lastId = null;

  while (true) {
    const stores = await prisma.store.findMany({
      where: { isUnInstalled: false },
      select: { id: true, shopUrl: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(lastId && {
        cursor: { id: lastId },
        skip: 1,
      }),
    });

    if (stores.length === 0) break;

    for (const store of stores) {
      await syncStore(store.shopUrl);
    }

    lastId = stores[stores.length - 1].id;
  }
}

// ============================================
// WORKER
// ============================================
export const productSyncWorker = new Worker(
  "product-sync-queue",
  async (job) => {
    const { shopUrl, type } = job.data;

    try {
      if (type === "auto-sync") {
        await handleAutoSync();
      } else if (type === "priority-sync") {
        await handlePrioritySync();
      } else if (shopUrl) {
        await syncStore(shopUrl);
      } else {
        await syncAllStoresBatched();
      }
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error?.message || error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 10,
      duration: 60000,
    },
  },
);

// ============================================
// AUTO SYNC (6 HOURS)
// ============================================
async function handleAutoSync() {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  const storesToSync = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      OR: [
        { lastProductSyncAt: { lt: sixHoursAgo } },
        { lastProductSyncAt: null },
      ],
    },
    select: { shopUrl: true },
    orderBy: { lastProductSyncAt: "asc" },
    take: 10,
  });

  for (let i = 0; i < storesToSync.length; i++) {
    const store = storesToSync[i];

    await productSyncQueue.add(
      "auto-sync-job",
      { shopUrl: store.shopUrl },
      {
        delay: i * 30000,
        jobId: `sync-${store.shopUrl}-${Date.now()}`,
      },
    );
  }
}

// ============================================
// PRIORITY SYNC (2 HOURS)
// ============================================
async function handlePrioritySync() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const activeStores = await prisma.store.findMany({
    where: {
      isUnInstalled: false,
      lastProductSyncAt: { lt: twoHoursAgo },
      OR: [{ lastActivityAt: { gt: twoHoursAgo } }],
    },
    select: { shopUrl: true },
    take: 5,
  });

  for (const store of activeStores) {
    await productSyncQueue.add(
      "priority-sync-job",
      { shopUrl: store.shopUrl },
      {
        priority: 1,
        jobId: `priority-sync-${store.shopUrl}-${Date.now()}`,
      },
    );
  }
}

// ============================================
// SYNC SINGLE STORE (FIXED)
// ============================================
async function syncStore(shopUrl) {
  try {
    const session = await restoreSession(shopUrl);

    if (!session) {
      console.warn(`⚠️ No session for ${shopUrl}`);
      return;
    }

    // 🔹 check if already running
    const { status } = await getCurrentBulkOperationStatus(session, "QUERY");

    if (status === "RUNNING") {
      console.log(`⏳ Bulk already running for ${shopUrl}`);
      return;
    }

    // 🔹 get latest bulk operation ID
    const bulkOperation = await getCurrentBulkOperationStatus(session, "QUERY");

    if (!bulkOperation?.id) {
      console.warn("⚠️ No bulk operation found");
      return;
    }

    // 🔹 fetch bulk details
    const client = new shopify.api.clients.Graphql({ session });

    const response = await client.query({
      data: {
        query: `
          query ($id: ID!) {
            node(id: $id) {
              ... on BulkOperation {
                id
                status
                url
              }
            }
          }
        `,
        variables: { id: bulkOperation.id },
      },
    });

    const node = response?.body?.data?.node;

    if (!node?.url) {
      console.warn("⚠️ No bulk URL yet");
      return;
    }

    console.log("🔥 BULK URL:", node.url);

    // 🔹 download JSONL file
    const axios = (await import("axios")).default;

    const streamResponse = await axios.get(node.url, {
      responseType: "stream",
    });

    // 🔥 THIS IS THE FIX
    await productSyncService.formatAndSyncProductsToDB({
      dataStream: streamResponse.data,
      shop: session.shop,
    });

    console.log(`✅ Sync completed for ${shopUrl}`);

  } catch (error) {
    console.error(`❌ Error syncing ${shopUrl}:`, error?.message || error);
  }
}

// ============================================
// RESTORE SESSION
// ============================================
async function restoreSession(shop) {
  try {
    const sessionId = `offline_${shop}`;
    const session = await shopify.config.sessionStorage.loadSession(sessionId);

    return session || null;
  } catch (err) {
    console.error("❌ Session restore error:", err?.message || err);
    return null;
  }
}

// ============================================
// EVENTS
// ============================================
productSyncWorker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

productSyncWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err?.message || err);
});

productSyncWorker.on("error", (err) => {
  console.error("❌ Worker error:", err);
});