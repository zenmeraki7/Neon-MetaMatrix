import { PrismaClient, SyncRun, SyncRunMode, SyncRunPhase, SyncRunStatus } from "@prisma/client";

const prisma = new PrismaClient();

export async function createDeltaSyncRun(input: {
  shopId: string;
  phase: SyncRunPhase;
}): Promise<SyncRun> {
  return prisma.syncRun.create({
    data: {
      shopId: input.shopId,
      phase: input.phase,
      mode: SyncRunMode.DELTA,
      status: SyncRunStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

export async function completeDeltaSyncRun(input: {
  syncRunId: string;
  statsJson?: unknown;
}): Promise<SyncRun> {
  return prisma.syncRun.update({
    where: { id: input.syncRunId },
    data: {
      status: SyncRunStatus.COMPLETED,
      completedAt: new Date(),
      statsJson: (input.statsJson as object | null) ?? undefined,
    },
  });
}

export async function failDeltaSyncRun(input: {
  syncRunId: string;
  errorCode: string;
  errorMessage: string;
  statsJson?: unknown;
}): Promise<SyncRun> {
  return prisma.syncRun.update({
    where: { id: input.syncRunId },
    data: {
      status: SyncRunStatus.FAILED,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedAt: new Date(),
      statsJson: (input.statsJson as object | null) ?? undefined,
    },
  });
}