import logger from "../../utils/loggerUtils.js";
import promClient from "prom-client";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { collectionRepository } from "../../repositories/collection.repository.js";
import { syncRepository } from "../../repositories/sync.repository.js";

export const metrics = {
  collectionFetchLatency: new promClient.Histogram({
    name: "collection_fetch_latency_seconds",
    help: "Time to fetch collections by source",
    buckets: [0.1, 0.3, 0.5, 1, 2, 5],
    labelNames: ["source"],
  }),
  cacheHits: new promClient.Counter({
    name: "collection_cache_hit_total",
    help: "Cache hits by source",
    labelNames: ["source"],
  }),
  cacheMisses: new promClient.Counter({
    name: "collection_cache_miss_total",
    help: "Cache misses total",
    labelNames: ["level"],
  }),
  syncJobs: new promClient.Counter({
    name: "collection_sync_jobs_total",
    help: "Total sync jobs by status",
    labelNames: ["status"],
  }),
};

const BULK_OPERATION_MUTATION = `mutation {
  bulkOperationRunQuery(
    query: """
      {
        collections {
          edges {
            node {
              id
              title
            }
          }
        }
      }
    """
  ) {
    bulkOperation {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}`;

function getErrorMessage(err, fallback = "Unknown error") {
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

export class CollectionService {
  constructor(shopifyClient) {
    this.shopify = shopifyClient;
  }

  async fetchCollections(session, search = "") {
    const startedAt = process.hrtime.bigint();
    const shop = session.shop;
    const normalizedSearch = String(search || "").trim();
    const cacheKey = `${shop}:fetchCollections:${normalizedSearch}`;

    const cacheCollections = await getCache(cacheKey);
    if (cacheCollections) {
      metrics.cacheHits.inc({ source: "cache" });
      metrics.collectionFetchLatency
        .labels("cache")
        .observe(Number(process.hrtime.bigint() - startedAt) / 1e9);

      return {
        message: "Collections from cache",
        data: cacheCollections,
      };
    }

    metrics.cacheMisses.inc({ level: "data" });

    const dbCollections = await collectionRepository.findCollectionsByShop({
      shop,
      search: normalizedSearch,
      take: 20,
    });

    await setCache(cacheKey, dbCollections, 300);

    metrics.collectionFetchLatency
      .labels("database")
      .observe(Number(process.hrtime.bigint() - startedAt) / 1e9);

    return {
      message: "Collection from database",
      data: dbCollections,
    };
  }

  async clearCollections(session) {
    const shop = session.shop;

    try {
      const client = new this.shopify.api.clients.Graphql({ session });

      const bulkResponse = await client.query({
        data: {
          query: BULK_OPERATION_MUTATION,
        },
      });

      const topLevelErrors = bulkResponse?.body?.errors || [];
      if (topLevelErrors.length > 0) {
        throw new Error(topLevelErrors[0]?.message || "Shopify bulk query failed");
      }

      const runQueryResult = bulkResponse?.body?.data?.bulkOperationRunQuery;
      const userErrors = runQueryResult?.userErrors || [];
      if (userErrors.length > 0) {
        throw new Error(userErrors[0]?.message || "Shopify returned bulk query userErrors");
      }

      const bulkOperationId = runQueryResult?.bulkOperation?.id;
      if (!bulkOperationId) {
        throw new Error("Bulk operation ID missing from Shopify response");
      }

      await syncRepository.markCollectionSyncing({
        shopUrl: shop,
        lastCollectionSyncAt: new Date(),
      });

      await syncRepository.createSyncHistory({
        shop,
        status: "processing",
        bulkOperationId,
        operationType: "Collection",
        duration: 0,
        recordCount: 0,
      });

      metrics.syncJobs.inc({ status: "processing" });

      return {
        message: "Collections syncing started",
        operationId: bulkOperationId,
      };
    } catch (err) {
      logger.error("Failed to clear collections", {
        shop,
        error: getErrorMessage(err),
      });

      throw err;
    }
  }
}