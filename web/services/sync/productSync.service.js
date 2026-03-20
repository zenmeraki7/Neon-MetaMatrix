import shopify from "../../shopify.js";
import readline from "readline";
import { prisma } from "../../config/database.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { syncRepository } from "../../repositories/sync.repository.js";

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export class ProductSyncService {
  // ==================================================
  // 🚀 START BULK OPERATION (FIXED QUERY)
  // ==================================================
  async startBulkOperationToFetchProducts({ session, isInitialSync = false }) {
    if (!session?.shop) {
      throw createHttpError(401, "Invalid shop session");
    }

    const client = new shopify.api.clients.Graphql({ session });

    const query = `
      mutation {
        bulkOperationRunQuery(
          query: """
          {
            products {
              edges {
                node {
                  id
                  title
                  handle
                  productType
                  vendor
                  status
                  createdAt
                  updatedAt
                  variants {
                    edges {
                      node {
                        id
                        title
                        price
                        sku
                      }
                    }
                  }
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
            message
          }
        }
      }
    `;

    const response = await client.query({ data: query });

    const result = response?.body?.data?.bulkOperationRunQuery;

    if (result?.userErrors?.length) {
      throw createHttpError(400, JSON.stringify(result.userErrors));
    }

    if (!result?.bulkOperation?.id) {
      throw createHttpError(500, "Bulk operation failed");
    }

    await syncRepository.markProductSyncing({
      shopUrl: session.shop,
      lastProductSyncAt: new Date(),
    });

    await clearKeyCaches(`${session.shop}:sync_details`);

    await syncRepository.createSyncHistory({
      shop: session.shop,
      bulkOperationId: result.bulkOperation.id,
      status: "processing",
      operationType: "Product",
      isInitialProductSync: isInitialSync,
    });

    return {
      message: "Bulk product sync started",
      bulkOperationId: result.bulkOperation.id,
    };
  }

  // ==================================================
  // 🔥 MAIN SYNC LOGIC (FINAL FIXED VERSION)
  // ==================================================
  async formatAndSyncProductsToDB({
    dataStream,
    shop,
    replaceShopData = false,
  }) {
    let totalProductsProcessed = 0;
    let totalVariantsProcessed = 0;

    try {
      if (!shop) {
        throw new Error("Shop is required for syncing");
      }

      // 🔴 optional full reset
      if (replaceShopData) {
        await prisma.variant.deleteMany({ where: { shop } });
        await prisma.product.deleteMany({ where: { shop } });
      }

      const rl = readline.createInterface({
        input: dataStream,
        crlfDelay: Infinity,
      });

      const BATCH_SIZE = 100;

      let productBatch = [];
      let variantBatch = [];

      const flush = async () => {
        if (!productBatch.length && !variantBatch.length) return;

        await prisma.$transaction([
          prisma.product.createMany({
            data: productBatch,
            skipDuplicates: true,
          }),
          prisma.variant.createMany({
            data: variantBatch,
            skipDuplicates: true,
          }),
        ]);

        productBatch = [];
        variantBatch = [];
      };

      for await (const line of rl) {
        if (!line.trim()) continue;

        let json;
        try {
          json = JSON.parse(line);
        } catch {
          continue;
        }

        // ✅ Shopify Bulk returns flat JSONL (NOT edges)
        if (json.__typename === "Product") {
          productBatch.push({
            shop,
            shopifyId: json.id,
            title: json.title || "",
            handle: json.handle || "",
            productType: json.productType || "",
            vendor: json.vendor || "",
            status: json.status || "ACTIVE",
            createdAt: json.createdAt
              ? new Date(json.createdAt)
              : new Date(),
            updatedAt: json.updatedAt
              ? new Date(json.updatedAt)
              : new Date(),
          });

          totalProductsProcessed++;
        }

        if (json.__typename === "ProductVariant") {
          variantBatch.push({
            shop,
            shopifyId: json.id,
            productId: json.product?.id || null, // important
            title: json.title || "",
            price: Number(json.price || 0),
            sku: json.sku || "",
          });

          totalVariantsProcessed++;
        }

        if (
          productBatch.length >= BATCH_SIZE ||
          variantBatch.length >= BATCH_SIZE
        ) {
          await flush();
        }
      }

      await flush();

      console.log(`✅ Sync completed for ${shop}`);
      console.log(`Products: ${totalProductsProcessed}`);
      console.log(`Variants: ${totalVariantsProcessed}`);

      return {
        totalProductsProcessed,
        totalVariantsProcessed,
      };
    } catch (error) {
      console.error("❌ Sync failed:", error);
      throw error;
    }
  }
}

export const productSyncService = new ProductSyncService();