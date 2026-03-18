function extractShopFromSession(session) {
  return String(session?.shop ?? "").trim();
}

export function getShopSession(res) {
  return res?.locals?.shopify?.session ?? null;
}

export function assertShopSession(res) {
  const session = getShopSession(res);
  const shop = extractShopFromSession(session);

  if (!shop) {
    const error = new Error("Session expired");
    error.statusCode = 403;
    throw error;
  }

  return session;
}