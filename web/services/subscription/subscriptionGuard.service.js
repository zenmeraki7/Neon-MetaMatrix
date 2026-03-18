function toSafeCount(value) {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function toSafeLimit(value, fallback = 100) {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizePlanName(value, fallback = "Free Plan") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeIsUnlimited(value) {
  return value === true;
}

function getNormalizedSubscription(subscription = {}) {
  return {
    limit: toSafeLimit(subscription?.limit, 100),
    planName: normalizePlanName(subscription?.planName, "Free Plan"),
    isUnlimited: normalizeIsUnlimited(subscription?.isUnlimited),
  };
}

export function enforceBulkEditLimit({ count, subscription = {} }) {
  const normalizedCount = toSafeCount(count);
  const { limit, planName, isUnlimited } =
    getNormalizedSubscription(subscription);

  if (!isUnlimited && normalizedCount > limit) {
    const error = new Error(
      `Your current plan (${planName}) allows editing up to ${limit} products at a time. You are trying to edit ${normalizedCount} products. Please upgrade your plan or reduce the number of products.`,
    );
    error.statusCode = 403;
    error.code = "PRODUCT_LIMIT_EXCEEDED";
    throw error;
  }

  return {
    limit,
    planName,
    isUnlimited,
  };
}

export function buildBulkEditSubscriptionWarning({
  count,
  subscription = {},
}) {
  const normalizedCount = toSafeCount(count);
  const { limit, planName, isUnlimited } =
    getNormalizedSubscription(subscription);

  if (isUnlimited) {
    return null;
  }

  if (normalizedCount > limit) {
    return {
      type: "LIMIT_EXCEEDED",
      message: `Your current plan (${planName}) allows editing up to ${limit} products. You're trying to edit ${normalizedCount} products. Please upgrade your plan or reduce the number of products.`,
    };
  }

  if (normalizedCount > limit * 0.8) {
    const remaining = Math.max(limit - normalizedCount, 0);

    return {
      type: "APPROACHING_LIMIT",
      message: `You're editing ${normalizedCount} products. Your plan allows ${limit} products per edit. ${remaining} products remaining.`,
    };
  }

  return null;
}