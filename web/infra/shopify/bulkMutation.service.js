import {
  bulkOperationMutation,
  getProductSetMutation,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import { bulkEditCacheService } from "../../cache/bulkEditCache.service.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeOperationName(operationName) {
  const normalized = String(operationName ?? "").trim();
  return normalized || `bulkEditProducts_${Date.now()}`;
}

function getResponseBody(response) {
  if (!response || typeof response !== "object") {
    return {};
  }

  return response.body ?? response;
}

function getGraphqlErrors(response) {
  const body = getResponseBody(response);
  return Array.isArray(body?.errors) ? body.errors : [];
}

function getStagedUploadUserErrors(response) {
  const body = getResponseBody(response);
  const errors = body?.data?.stagedUploadsCreate?.userErrors;
  return Array.isArray(errors) ? errors : [];
}

function getBulkRunUserErrors(response) {
  const body = getResponseBody(response);
  const errors = body?.data?.bulkOperationRunMutation?.userErrors;
  return Array.isArray(errors) ? errors : [];
}

function getStagedTarget(response) {
  const body = getResponseBody(response);
  return body?.data?.stagedUploadsCreate?.stagedTargets?.[0] ?? null;
}

function getBulkRunPayload(response) {
  const body = getResponseBody(response);
  return body?.data?.bulkOperationRunMutation ?? null;
}

function getFirstErrorMessage(errors, fallbackMessage) {
  const firstMessage = String(errors?.[0]?.message ?? "").trim();
  return firstMessage || fallbackMessage;
}

function buildError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function runShopifyBulkMutation({
  client,
  shop,
  operationName,
  formattedProducts,
  mutation,
}) {
  if (!client) {
    throw buildError("Shopify GraphQL client is required", 500);
  }

  const normalizedShop = normalizeShop(shop);
  const normalizedOperationName = normalizeOperationName(operationName);

  if (!mutation || typeof mutation !== "string") {
    throw buildError("Bulk mutation string is required", 500);
  }

  const stagedRes = await client.query({
    data: {
      query: stagesUploadMutation,
      variables: {
        input: [
          {
            filename: normalizedOperationName,
            mimeType: "text/jsonl",
            resource: "BULK_MUTATION_VARIABLES",
            httpMethod: "POST",
          },
        ],
      },
    },
  });

  const stagedGraphqlErrors = getGraphqlErrors(stagedRes);

  if (stagedGraphqlErrors.length > 0) {
    throw buildError(
      getFirstErrorMessage(
        stagedGraphqlErrors,
        "Failed to create Shopify staged upload",
      ),
      502,
    );
  }

  const stagedUserErrors = getStagedUploadUserErrors(stagedRes);

  if (stagedUserErrors.length > 0) {
    throw buildError(
      `Shopify API returned errors: ${JSON.stringify(stagedUserErrors)}`,
      400,
    );
  }

  const target = getStagedTarget(stagedRes);

  if (!target) {
    throw buildError("Failed to get staged upload target from Shopify", 502);
  }

  const stagedUploadPath = await uploadToShopifyStagedTarget(
    target,
    formattedProducts,
  );

  if (!stagedUploadPath || typeof stagedUploadPath !== "string") {
    throw buildError("Failed to upload bulk mutation payload to Shopify", 502);
  }

  const bulkRes = await client.query({
    data: {
      query: bulkOperationMutation,
      variables: {
        mutation,
        stagedUploadPath,
      },
    },
  });

  const bulkGraphqlErrors = getGraphqlErrors(bulkRes);

  if (bulkGraphqlErrors.length > 0) {
    throw buildError(
      getFirstErrorMessage(
        bulkGraphqlErrors,
        "Failed to start Shopify bulk mutation",
      ),
      502,
    );
  }

  const bulkUserErrors = getBulkRunUserErrors(bulkRes);

  if (bulkUserErrors.length > 0) {
    throw buildError(
      `Bulk operation returned errors: ${JSON.stringify(bulkUserErrors)}`,
      400,
    );
  }

  const bulkRunPayload = getBulkRunPayload(bulkRes);

  if (!bulkRunPayload) {
    throw buildError("Failed to start Shopify bulk mutation", 502);
  }

  if (normalizedShop) {
    await bulkEditCacheService.markProductUpdateRunning(normalizedShop);
  }

  return bulkRunPayload;
}

export function buildBulkMutationPayload({ field, mode, PRODUCT_SET_MODE }) {
  return {
    operationName: `bulkEditProducts_${Date.now()}`,
    mutation: getProductSetMutation(mode || PRODUCT_SET_MODE.PRODUCT_ONLY),
  };
}