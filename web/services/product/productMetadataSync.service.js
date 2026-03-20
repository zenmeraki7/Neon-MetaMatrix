// web/services/product/productMetadataSync.service.js
import shopify from "../../shopify.js";
import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { syncRepository } from "../../repositories/sync.repository.js";

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getTopLevelErrors(response) {
  return Array.isArray(response?.body?.errors) ? response.body.errors : [];
}

function getUserErrors(response) {
  return (
    response?.body?.data?.bulkOperationRunQuery?.userErrors || []
  );
}

function getBulkOperation(response) {
  return response?.body?.data?.bulkOperationRunQuery?.bulkOperation || null;
}

function normalizeSession(session) {
  return session && typeof session === "object" ? session : null;
}

function normalizeShop(session) {
  return typeof session?.shop === "string" ? session.shop.trim() : "";
}

function buildProductTypeBulkQueryMutation() {
  return `
    mutation {
      bulkOperationRunQuery(
        query: """
          {
            products {
              edges {
                node {
                  id
                  productType
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
    }
  `;
}

export class ProductMetadataSyncService {
  async clearProductTypes({ session }) {
    const normalizedSession = normalizeSession(session);
    const shop = normalizeShop(normalizedSession);

    if (!normalizedSession || !shop) {
      throw createHttpError("Shopify session missing", 401);
    }

    const { status } = await getCurrentBulkOperationStatus(
      normalizedSession,
      "QUERY",
    );

    if (status === "RUNNING") {
      throw createHttpError("Another operation is running in background", 400);
    }

    const client = new shopify.api.clients.Graphql({
      session: normalizedSession,
    });

    const response = await client.query({
      data: {
        query: buildProductTypeBulkQueryMutation(),
      },
    });

    const topLevelErrors = getTopLevelErrors(response);
    if (topLevelErrors.length > 0) {
      throw createHttpError(
        topLevelErrors[0]?.message || "Failed to start product type sync",
        502,
      );
    }

    const userErrors = getUserErrors(response);
    if (userErrors.length > 0) {
      throw createHttpError(
        userErrors[0]?.message || "Failed to start product type sync",
        400,
      );
    }

    const bulkOperation = getBulkOperation(response);
    const bulkOperationId = bulkOperation?.id;

    if (!bulkOperationId) {
      throw createHttpError("Failed to start product type sync", 502);
    }

    await syncRepository.markProductTypeSyncing({
      shopUrl: shop,
      lastProductTypeSyncAt: new Date(),
    });

    await syncRepository.createSyncHistory({
      shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: "ProductType",
    });

    await clearKeyCaches(`${shop}:sync_details`);

    return {
      message: "productType syncing started",
      operationId: bulkOperationId,
    };
  }
}

export const productMetadataSyncService = new ProductMetadataSyncService();