// web/services/shared/shopOperationLock.service.js

import crypto from "crypto";
import {
  getCache,
  setCache,
  clearKeyCaches,
} from "../../utils/cacheUtils.js";

const inMemoryStore = new Map();

// =========================
// HELPERS
// =========================
function createHttpError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeShop(shop) {
  return typeof shop === "string" ? shop.trim() : "";
}

function normalizeScope(scope) {
  return typeof scope === "string" && scope.trim() ? scope.trim() : "default";
}

function normalizeIdempotencyKey(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNow() {
  return Date.now();
}

function buildLockKey(shop, scope) {
  return `${shop}:oplock:${scope}`;
}

function safeClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableNormalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableNormalize(value));
}

function buildHash(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function parseCacheValue(value) {
  if (!value) return null;

  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return null;
}

function isExpired(record) {
  return !record?.expiresAt || record.expiresAt <= getNow();
}

// =========================
// STORAGE
// =========================
async function readLock(key) {
  try {
    const cached = await getCache(key);
    const parsed = parseCacheValue(cached);

    if (parsed && !isExpired(parsed)) {
      return parsed;
    }
  } catch {}

  const memoryRecord = inMemoryStore.get(key);

  if (!memoryRecord) return null;

  if (isExpired(memoryRecord)) {
    inMemoryStore.delete(key);
    return null;
  }

  return memoryRecord;
}

async function writeLock(key, record, ttlSeconds) {
  inMemoryStore.set(key, record);

  try {
    await setCache(key, record, ttlSeconds);
  } catch {}
}

async function deleteLock(key) {
  inMemoryStore.delete(key);

  try {
    await clearKeyCaches(key);
  } catch {}
}

function createToken() {
  return crypto.randomUUID();
}

// =========================
// SERVICE
// =========================
export class ShopOperationLockService {
  buildIdempotencyKey({ explicitKey, payload, shop, scope }) {
    const normalizedExplicitKey = normalizeIdempotencyKey(explicitKey);

    if (normalizedExplicitKey) return normalizedExplicitKey;

    return buildHash({
      shop: normalizeShop(shop),
      scope: normalizeScope(scope),
      payload: payload ?? null,
    });
  }

  // =========================
  // 🔥 FIXED LOCK LOGIC
  // =========================
  async acquireOperation({
    shop,
    scope,
    idempotencyKey,
    payload = null,
    lockTtlSeconds = 900,
    replayTtlSeconds = 3600,
  }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedScope = normalizeScope(scope);

    if (!normalizedShop) {
      throw createHttpError("Shop is required", 500);
    }

    const key = buildLockKey(normalizedShop, normalizedScope);

    const derivedIdempotencyKey = this.buildIdempotencyKey({
      explicitKey: idempotencyKey,
      payload,
      shop: normalizedShop,
      scope: normalizedScope,
    });

    let existing = await readLock(key);

    // 🧹 REMOVE EXPIRED LOCK
    if (existing && isExpired(existing)) {
      await deleteLock(key);
      existing = null;
    }

    if (existing) {
      // ✅ SAME REQUEST → REPLAY
      if (existing.idempotencyKey === derivedIdempotencyKey) {
        if (existing.state === "completed") {
          return {
            replay: true,
            result: safeClone(existing.result),
            token: existing.token,
          };
        }

        throw createHttpError(
          "Same request already in progress",
          409,
          "OPERATION_ALREADY_IN_PROGRESS"
        );
      }

      // ✅ COMPLETED → ALLOW NEW
      if (existing.state === "completed") {
        await deleteLock(key);
      } else {
        // ❌ RUNNING → BLOCK
        throw createHttpError(
          "Another operation is already in progress for this shop",
          409,
          "SHOP_OPERATION_LOCKED"
        );
      }
    }

    // 🚀 CREATE LOCK
    const token = createToken();
    const expiresAt = getNow() + lockTtlSeconds * 1000;

    const record = {
      token,
      shop: normalizedShop,
      scope: normalizedScope,
      idempotencyKey: derivedIdempotencyKey,
      state: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt,
      replayTtlSeconds,
    };

    await writeLock(key, record, lockTtlSeconds);

    return {
      replay: false,
      token,
    };
  }

  // =========================
  async completeOperation({
    shop,
    scope,
    token,
    result,
    replayTtlSeconds = 3600,
  }) {
    const key = buildLockKey(normalizeShop(shop), normalizeScope(scope));

    const existing = await readLock(key);

    if (!existing || existing.token !== token) return;

    const updated = {
      ...existing,
      state: "completed",
      result: safeClone(result),
      updatedAt: new Date().toISOString(),
      expiresAt: getNow() + replayTtlSeconds * 1000,
    };

    await writeLock(key, updated, replayTtlSeconds);
  }

  // =========================
  async releaseOperation({ shop, scope, token }) {
    const key = buildLockKey(normalizeShop(shop), normalizeScope(scope));

    const existing = await readLock(key);

    if (!existing) return;
    if (token && existing.token !== token) return;

    await deleteLock(key);
  }
}

export const shopOperationLockService = new ShopOperationLockService();