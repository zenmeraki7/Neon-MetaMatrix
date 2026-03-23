import { ShopSyncStatus } from "@prisma/client";
import { findShopSyncCredentials, updateShopSyncStatus } from "../../repositories/shop.repository";
import { acquireShopSyncLock } from "./shopSyncLock.service";
import { enqueueInitialSyncPhase } from "./syncPhaseOrchestrator.service";

export interface BootstrapShopSyncInput {
  shopId: string;
}

export async function bootstrapShopSync(input: BootstrapShopSyncInput): Promise<void> {
  const shop = await findShopSyncCredentials(input.shopId);
  if (!shop) {
    throw new Error(`Shop not found for id ${input.shopId}`);
  }

  const lock = await acquireShopSyncLock({
    shopId: input.shopId,
    holder: "bootstrapShopSync",
  });

  try {
    await updateShopSyncStatus(input.shopId, ShopSyncStatus.BOOTSTRAPPING);
    await enqueueInitialSyncPhase({ shopId: input.shopId });
  } finally {
    await lock.release();
  }
}