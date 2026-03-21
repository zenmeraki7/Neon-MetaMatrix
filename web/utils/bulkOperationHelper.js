import shopify from "../shopify.js";

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeSession(session) {
  return session && typeof session === "object" ? session : null;
}

function normalizeBulkOperationType(type) {
  const normalized = String(type ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "QUERY" || normalized === "MUTATION") {
    return normalized;
  }

  return "MUTATION";
}

function getTopLevelErrors(response) {
  return Array.isArray(response?.body?.errors) ? response.body.errors : [];
}

function getCurrentBulkOperationNode(response) {
  return response?.body?.data?.currentBulkOperation || null;
}

function getBulkOperationNode(response) {
  return response?.body?.data?.node || null;
}

export async function getCurrentBulkOperationStatus(
  session,
  type = "MUTATION",
) {
  const normalizedSession = normalizeSession(session);

  if (!normalizedSession?.shop) {
    throw createHttpError("Invalid shop session", 401);
  }

  const normalizedType = normalizeBulkOperationType(type);

  const query = `
    query {
      currentBulkOperation(type: ${normalizedType}) {
        id
        type
        status
        errorCode
        createdAt
        completedAt
        url
        partialDataUrl
        query
      }
    }
  `;

  const client = new shopify.api.clients.Graphql({ session: normalizedSession });

  const response = await client.query({
    data: { query },
  });

  const topLevelErrors = getTopLevelErrors(response);
  if (topLevelErrors.length > 0) {
    throw createHttpError(
      topLevelErrors[0]?.message || "Failed to fetch current bulk operation status",
      502,
    );
  }

  const currentBulkOperation = getCurrentBulkOperationNode(response);

  return currentBulkOperation || { status: "COMPLETED" };
}

export const getBulkEditStatus = async (bulkOperationId, session) => {
  const normalizedSession = normalizeSession(session);

  if (!bulkOperationId) {
    throw createHttpError("Bulk operation ID is required", 400);
  }

  if (!normalizedSession?.shop) {
    throw createHttpError("Invalid shop session", 401);
  }

  const client = new shopify.api.clients.Graphql({ session: normalizedSession });

  const query = `
    query GetBulkOperationResults($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          status
          errorCode
          rootObjectCount
        }
      }
    }
  `;

  const variables = {
    id: bulkOperationId,
  };

  const response = await client.query({
    data: {
      query,
      variables,
    },
  });

  const topLevelErrors = getTopLevelErrors(response);
  if (topLevelErrors.length > 0) {
    throw createHttpError(
      topLevelErrors[0]?.message || "Failed to fetch bulk operation result",
      502,
    );
  }

  const bulkOperation = getBulkOperationNode(response);

  if (!bulkOperation) {
    throw createHttpError("Bulk operation not found", 404);
  }

  return bulkOperation;
};