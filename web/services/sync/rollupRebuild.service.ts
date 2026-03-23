import { Prisma, PrismaClient, SyncRunMode, SyncRunPhase } from "@prisma/client";
import { markShopSyncHealthy } from "../../repositories/shop.repository";
import { createSyncRun, markSyncRunCompleted, markSyncRunFailed } from "../../repositories/syncRun.repository";

const prisma = new PrismaClient();

export interface EnqueueRollupRebuildInput {
  shopId: string;
}

export async function enqueueRollupRebuild(
  input: EnqueueRollupRebuildInput,
): Promise<void> {
  const syncRun = await createSyncRun({
    shopId: input.shopId,
    phase: SyncRunPhase.ROLLUP_REBUILD_CORE,
    mode: SyncRunMode.BOOTSTRAP,
  });

  try {
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE product_mirror p
        SET
          variant_count_rollup = COALESCE(v.variant_count, 0),
          total_inventory_rollup = COALESCE(v.total_inventory, 0),
          min_price_rollup = v.min_price,
          max_price_rollup = v.max_price,
          min_compare_at_price_rollup = v.min_compare_at_price,
          max_compare_at_price_rollup = v.max_compare_at_price,
          updated_at = NOW()
        FROM (
          SELECT
            shop_id,
            product_gid,
            COUNT(*) FILTER (WHERE deleted_at IS NULL) AS variant_count,
            COALESCE(SUM(inventory_quantity_rollup) FILTER (WHERE deleted_at IS NULL), 0) AS total_inventory,
            MIN(price) FILTER (WHERE deleted_at IS NULL) AS min_price,
            MAX(price) FILTER (WHERE deleted_at IS NULL) AS max_price,
            MIN(compare_at_price) FILTER (WHERE deleted_at IS NULL) AS min_compare_at_price,
            MAX(compare_at_price) FILTER (WHERE deleted_at IS NULL) AS max_compare_at_price
          FROM variant_mirror
          WHERE shop_id = ${input.shopId}::uuid
          GROUP BY shop_id, product_gid
        ) v
        WHERE p.shop_id = v.shop_id
          AND p.product_gid = v.product_gid
          AND p.shop_id = ${input.shopId}::uuid
      `,
      prisma.$executeRaw`
        UPDATE variant_mirror v
        SET
          inventory_quantity_rollup = COALESCE(i.total_available, 0),
          updated_at = NOW()
        FROM (
          SELECT
            shop_id,
            variant_gid,
            COALESCE(SUM(available), 0) AS total_available
          FROM inventory_level_mirror
          WHERE shop_id = ${input.shopId}::uuid
            AND variant_gid IS NOT NULL
          GROUP BY shop_id, variant_gid
        ) i
        WHERE v.shop_id = i.shop_id
          AND v.variant_gid = i.variant_gid
          AND v.shop_id = ${input.shopId}::uuid
      `,
    ]);

    await markSyncRunCompleted({
      syncRunId: syncRun.id,
      statsJson: {
        stage: "rollup_rebuild",
        rebuilt: true,
      } satisfies Prisma.InputJsonValue,
    });

    await markShopSyncHealthy(input.shopId);
  } catch (error) {
    await markSyncRunFailed({
      syncRunId: syncRun.id,
      errorCode: error instanceof Error ? error.name : "ERROR",
      errorMessage: error instanceof Error ? error.message : "Unknown rollup rebuild error",
      statsJson: {
        stage: "rollup_rebuild",
      },
    });

    throw error;
  }
}