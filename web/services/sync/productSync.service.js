import shopify from "../../shopify.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { syncRepository } from "../../repositories/sync.repository.js";

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export class ProductSyncService {
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

    const errors = response?.body?.errors;
    if (errors?.length) {
      throw createHttpError(500, errors[0].message);
    }

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
}

export const productSyncService = new ProductSyncService();