import {
  SyncRunMode,
  SyncRunPhase,
} from "@prisma/client";
import { createSyncRun } from "../../repositories/syncRun.repository";
import { enqueueSyncPhaseDispatch } from "../../Jobs/Workers/syncPhase.worker";

const PHASE_ORDER: readonly SyncRunPhase[] = [
  SyncRunPhase.BULK_PRODUCTS_CORE,
  SyncRunPhase.BULK_VARIANTS_CORE,
  SyncRunPhase.BULK_COLLECTION_MEMBERSHIP,
  SyncRunPhase.BULK_INVENTORY_LEVELS,
];

export interface EnqueueInitialSyncPhasesInput {
  shopId: string;
}

export interface EnqueueNextSyncPhaseInput {
  shopId: string;
  completedPhase: SyncRunPhase;
}

export async function enqueueInitialSyncPhase(
  input: EnqueueInitialSyncPhasesInput,
): Promise<void> {
  const firstPhase = PHASE_ORDER[0];
  const syncRun = await createSyncRun({
    shopId: input.shopId,
    phase: firstPhase,
    mode: SyncRunMode.BOOTSTRAP,
  });

  await enqueueSyncPhaseDispatch({
    shopId: input.shopId,
    syncRunId: syncRun.id,
    phase: firstPhase,
  });
}

export async function enqueueNextSyncPhase(
  input: EnqueueNextSyncPhaseInput,
): Promise<void> {
  const currentIndex = PHASE_ORDER.indexOf(input.completedPhase);
  if (currentIndex < 0) {
    throw new Error(`Completed phase not found in phase order: ${input.completedPhase}`);
  }

  const nextPhase = PHASE_ORDER[currentIndex + 1];
  if (!nextPhase) {
    return;
  }

  const syncRun = await createSyncRun({
    shopId: input.shopId,
    phase: nextPhase,
    mode: SyncRunMode.BOOTSTRAP,
  });

  await enqueueSyncPhaseDispatch({
    shopId: input.shopId,
    syncRunId: syncRun.id,
    phase: nextPhase,
  });
}