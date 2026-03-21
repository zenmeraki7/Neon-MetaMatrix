import shopify from "../../shopify.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { syncRepository } from "../../repositories/sync.repository.js";

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
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

function buildProductBulkQueryMutation() {
  return `
    mutation {
      bulkOperationRunQuery(
        query: """
        {
          products {
            edges {
              node {
                __typename
                id
                title
                handle
                productType
                vendor
                status
                tags
                templateSuffix
                descriptionHtml
                createdAt
                updatedAt
                publishedAt
                totalInventory
                onlineStoreUrl
                seo {
                  title
                  description
                }
                category {
                  id
                  name
                }
                options {
                  id
                  name
                  position
                  values
                }
                collections(first: 50) {
                  edges {
                    node {
                      __typename
                      id
                      title
                    }
                  }
                }
                featuredMedia {
                  __typename
                  ... on MediaImage {
                    id
                    alt
                    preview {
                      image {
                        url
                        altText
                      }
                    }
                  }
                }
                variants {
                  edges {
                    node {
                      __typename
                      id
                      title
                      sku
                      barcode
                      price
                      compareAtPrice
                      inventoryQuantity
                      inventoryPolicy
                      taxable
                      taxCode
                      position
                      selectedOptions {
                        name
                        value
                      }
                      inventoryItem {
                        tracked
                        requiresShipping
                        countryCodeOfOrigin
                        harmonizedSystemCode
                        unitCost {
                          amount
                          currencyCode
                        }
                        measurement {
                          weight {
                            value
                            unit
                          }
                        }
                      }
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
          field
          message
        }
      }
    }
  `;
}

export class ProductSyncService {
  async startBulkOperationToFetchProducts({ session, isInitialSync = false }) {
    if (!session?.shop) {
      throw createHttpError(401, "Invalid shop session");
    }

    const client = new shopify.api.clients.Graphql({ session });

    const response = await client.query({
      data: {
        query: buildProductBulkQueryMutation(),
      },
    });

    const topLevelErrors = getTopLevelErrors(response);
    if (topLevelErrors.length > 0) {
      throw createHttpError(
        502,
        topLevelErrors[0]?.message || "Failed to start product sync",
      );
    }

    const userErrors = getUserErrors(response);
    if (userErrors.length > 0) {
      throw createHttpError(
        400,
        userErrors[0]?.message || "Failed to start product sync",
      );
    }

    const bulkOperation = getBulkOperation(response);

    if (!bulkOperation?.id) {
      throw createHttpError(500, "Bulk operation failed");
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
    };
  }
}

export const productSyncService = new ProductSyncService();