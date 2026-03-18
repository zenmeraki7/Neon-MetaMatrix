import shopify from "../../shopify.js";

const GET_TAXONOMY_CATEGORIES_QUERY = `
  query GetTopLevelTaxonomy($first: Int!, $search: String) {
    taxonomy {
      categories(first: $first, search: $search) {
        edges {
          node {
            id
            name
            fullName
          }
        }
      }
    }
  }
`;

function normalizePositiveInt(value, fallback = 20, max = 250) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSearch(search) {
  const normalized = String(search ?? "").trim();
  return normalized || null;
}

function getResponseBody(response) {
  if (!response || typeof response !== "object") {
    return {};
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

function getCategoryConnection(body) {
  return (
    body?.data?.taxonomy?.categories ??
    body?.body?.data?.taxonomy?.categories ??
    null
  );
}

function buildError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export class ShopifyTaxonomyService {
  async fetchCategories({ session, first = 20, search = null }) {
    const client = new shopify.api.clients.Graphql({ session });

    const response = await client.query({
      data: {
        query: GET_TAXONOMY_CATEGORIES_QUERY,
        variables: {
          first: normalizePositiveInt(first),
          search: normalizeSearch(search),
        },
      },
    });

    const body = getResponseBody(response);
    const errors = getTopLevelErrors(body);

    if (errors.length > 0) {
      throw buildError(
        String(errors[0]?.message ?? "").trim() ||
          "Failed to fetch Shopify taxonomy",
        502,
      );
    }

    const categories = getCategoryConnection(body);

    if (!categories) {
      throw buildError("Failed to fetch Shopify taxonomy", 502);
    }

    const userErrors = Array.isArray(categories?.userErrors)
      ? categories.userErrors
      : [];

    if (userErrors.length > 0) {
      throw buildError(
        String(userErrors[0]?.message ?? "").trim() ||
          "Failed to fetch Shopify taxonomy",
        400,
      );
    }

    return Array.isArray(categories?.edges) ? categories.edges : [];
  }
}

export const shopifyTaxonomyService = new ShopifyTaxonomyService();