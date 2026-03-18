import shopify from "../../shopify.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import { storeSyncRepository } from "../../repositories/storeSync.repository.js";

const BULK_OPERATION_MUTATION = `mutation {
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
}`;

function getResponseBody(response) {
  if (!response || typeof response !== "object") {
    return null;
  }

  return response.body ?? response;
}

function getTopLevelErrors(body) {
  if (Array.isArray(body?.errors)) {
    return body.errors;
  }

  if (Array.isArray(body?.body?.errors)) {
    return body.body.errors;
  }

  return [];
}

function getRunQueryResult(body) {
  return (
    body?.data?.bulkOperationRunQuery ??
    body?.body?.data?.bulkOperationRunQuery ??
    null
  );
}

function getFirstErrorMessage(errors, fallbackMessage) {
  const firstMessage = errors?.[0]?.message;
  return String(firstMessage ?? "").trim() || fallbackMessage;
}

export class ProductTypeSyncService {
  async startProductTypeSync({ session }) {
    const client = new shopify.api.clients.Graphql({ session });

    const bulkResponse = await client.query({
      data: {
        query: BULK_OPERATION_MUTATION,
      },
    });

    const body = getResponseBody(bulkResponse);
    const topLevelErrors = getTopLevelErrors(body);

    if (topLevelErrors.length > 0) {
      const error = new Error(
        getFirstErrorMessage(topLevelErrors, "Failed to start product type sync"),
      );
      error.statusCode = 500;
      throw error;
    }

    const runQueryResult = getRunQueryResult(body);
    const userErrors = Array.isArray(runQueryResult?.userErrors)
      ? runQueryResult.userErrors
      : [];

    if (userErrors.length > 0) {
      const error = new Error(
        getFirstErrorMessage(userErrors, "Failed to start product type sync"),
      );
      error.statusCode = 400;
      throw error;
    }

    const bulkOperationId = String(runQueryResult?.bulkOperation?.id ?? "").trim();

    if (!bulkOperationId) {
      const error = new Error("Failed to start product type sync");
      error.statusCode = 500;
      throw error;
    }

    const result = await storeSyncRepository.markProductTypeSyncStarted({
      shop: session.shop,
    });

    if (!result) {
      const error = new Error("Store not found");
      error.statusCode = 404;
      throw error;
    }

    await storeSyncRepository.createSyncHistory({
      shop: session.shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: "ProductType",
    });

    await clearKeyCaches(cacheKeys.syncDetails(session.shop));

    return {
      message: "productType syncing started",
      operationId: bulkOperationId,
    };
  }
}

export const productTypeSyncService = new ProductTypeSyncService();