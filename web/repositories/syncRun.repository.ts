import {
  Prisma,
  PrismaClient,
  SyncRun,
  SyncRunMode,
  SyncRunPhase,
  SyncRunStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

export interface CreateSyncRunInput {
  shopId: string;
  phase: SyncRunPhase;
  mode: SyncRunMode;
}

export interface MarkSyncRunBulkStartedInput {
  syncRunId: string;
  bulkOperationGid: string;
  bulkOperationStatus: string | null;
  bulkResultUrl: string | null;
  objectCount?: bigint | null;
  fileSizeBytes?: bigint | null;
  statsJson?: Prisma.InputJsonValue | null;
}

export interface MarkSyncRunCompletedInput {
  syncRunId: string;
  statsJson?: Prisma.InputJsonValue | null;
}

export interface MarkSyncRunFailedInput {
  syncRunId: string;
  errorCode: string;
  errorMessage: string;
  statsJson?: Prisma.InputJsonValue | null;
}

export async function createSyncRun(input: CreateSyncRunInput): Promise<SyncRun> {
  return prisma.syncRun.create({
    data: {
      shopId: input.shopId,
      phase: input.phase,
      mode: input.mode,
      status: SyncRunStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

export async function markSyncRunBulkStarted(
  input: MarkSyncRunBulkStartedInput,
): Promise<SyncRun> {
  return prisma.syncRun.update({
    where: { id: input.syncRunId },
    data: {
      bulkOperationGid: input.bulkOperationGid,
      bulkOperationStatus: input.bulkOperationStatus,
      bulkResultUrl: input.bulkResultUrl,
      objectCount: input.objectCount ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      statsJson: input.statsJson ?? Prisma.JsonNull,
    },
  });
}

export async function markSyncRunCompleted(
  input: MarkSyncRunCompletedInput,
): Promise<SyncRun> {
  return prisma.syncRun.update({
    where: { id: input.syncRunId },
    data: {
      status: SyncRunStatus.COMPLETED,
      completedAt: new Date(),
      statsJson: input.statsJson ?? Prisma.JsonNull,
    },
  });
}

export async function markSyncRunFailed(
  input: MarkSyncRunFailedInput,
): Promise<SyncRun> {
  return prisma.syncRun.update({
    where: { id: input.syncRunId },
    data: {
      status: SyncRunStatus.FAILED,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedAt: new Date(),
      statsJson: input.statsJson ?? Prisma.JsonNull,
    },
  });
}

export async function findSyncRunById(syncRunId: string): Promise<SyncRun | null> {
  return prisma.syncRun.findUnique({
    where: { id: syncRunId },
  });
}

export async function listSyncRunsForShop(shopId: string): Promise<SyncRun[]> {
  return prisma.syncRun.findMany({
    where: { shopId },
    orderBy: [{ createdAt: "asc" }],
  });
}