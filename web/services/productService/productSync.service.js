import shopify from "../../shopify.js";
import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { syncRepository } from "../../repositories/sync.repository.js";

class ProductSyncService {
  async startBulkOperationToFetchProducts({ session, isInitialSync = false }) {
    const client = new shopify.api.clients.Graphql({ session });
    const queryBody = String(graphqlProductsAllFieldQuery || "").trim();

    if (!queryBody) {
      throw new Error("graphqlProductsAllFieldQuery is empty");
    }

    const bulkQuery = `
      mutation {
        bulkOperationRunQuery(
          query: ${JSON.stringify(queryBody)}
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
      }
    `;

    const response = await client.query({ data: bulkQuery });

    const topLevelErrors = response?.body?.errors || [];
    if (topLevelErrors.length > 0) {
      throw new Error(topLevelErrors[0]?.message || "Shopify bulk query failed");
    }

    const runQueryResult = response?.body?.data?.bulkOperationRunQuery;
    const userErrors = runQueryResult?.userErrors || [];
    const bulkOperation = runQueryResult?.bulkOperation;

    if (userErrors.length > 0) {
      throw new Error(JSON.stringify(userErrors));
    }

    if (!bulkOperation?.id) {
      throw new Error("Bulk operation was not created");
    }

    await syncRepository.markProductSyncing({
      shopUrl: session.shop,
      lastProductSyncAt: new Date(),
    });

    await clearKeyCaches(`${session.shop}:sync_details`);

    await syncRepository.createSyncHistory({
      shop: session.shop,
      bulkOperationId: bulkOperation.id,
      status: "processing",
      operationType: "Product",
      isInitialProductSync: isInitialSync,
    });

    return {
      message: "Bulk product sync started",
      bulkOperationId: bulkOperation.id,
      response: response.body,
    };
  }
}

export const productSyncService = new ProductSyncService();