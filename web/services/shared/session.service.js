// web/services/shared/session.service.js
function createHttpError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeSession(session) {
  return session && typeof session === "object" ? session : null;
}

function normalizeShop(shop) {
  return typeof shop === "string" ? shop.trim() : "";
}

export function getShopifySession(res) {
  return normalizeSession(res?.locals?.shopify?.session);
}

export function assertShopSession(res, options = {}) {
  const {
    missingSessionMessage = "Session expired",
    missingShopMessage = "Shopify session missing",
    missingSessionStatusCode = 403,
    missingShopStatusCode = 401,
  } = options;

  const session = getShopifySession(res);

  if (!session) {
    throw createHttpError(missingSessionMessage, missingSessionStatusCode);
  }

  const shop = normalizeShop(session.shop);

  if (!shop) {
    throw createHttpError(missingShopMessage, missingShopStatusCode);
  }

  return {
    ...session,
    shop,
  };
}