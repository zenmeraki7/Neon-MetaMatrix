import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

export class ShopSyncLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopSyncLockError";
    Object.setPrototypeOf(this, ShopSyncLockError.prototype);
  }
}

export interface AcquireShopSyncLockInput {
  shopId: string;
  holder: string;
  ttlMs?: number;
}

export interface ShopSyncLockHandle {
  key: string;
  token: string;
  release: () => Promise<void>;
}

export async function acquireShopSyncLock(
  input: AcquireShopSyncLockInput,
): Promise<ShopSyncLockHandle> {
  const key = buildShopSyncLockKey(input.shopId);
  const token = `${input.holder}:${cryptoRandomId()}`;
  const ttlMs = input.ttlMs ?? DEFAULT_LOCK_TTL_MS;

  const result = await redis.set(key, token, "PX", ttlMs, "NX");
  if (result !== "OK") {
    throw new ShopSyncLockError(
      `Failed to acquire shop sync lock for shop ${input.shopId}`,
    );
  }

  return {
    key,
    token,
    release: async () => {
      await releaseShopSyncLock({ key, token });
    },
  };
}

export async function releaseShopSyncLock(input: {
  key: string;
  token: string;
}): Promise<void> {
  const releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  await redis.eval(releaseScript, 1, input.key, input.token);
}

export async function hasShopSyncLock(shopId: string): Promise<boolean> {
  const value = await redis.get(buildShopSyncLockKey(shopId));
  return typeof value === "string" && value.length > 0;
}

function buildShopSyncLockKey(shopId: string): string {
  return `sync:shop-lock:${shopId}`;
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}