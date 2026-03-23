import { JobsOptions, Queue, QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { SyncRunPhase } from "@prisma/client";
import { dispatchSyncPhase } from "../../services/sync/dispatchSyncPhase.service";
import { handleSyncPhaseIngest } from "../../services/sync/handleSyncPhaseIngest.service";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const SYNC_PHASE_QUEUE_NAME = "sync-phase-queue";

export const SYNC_PHASE_JOB_DISPATCH = "sync-phase-dispatch";
export const SYNC_PHASE_JOB_INGEST = "sync-phase-ingest";

export interface SyncPhaseDispatchJobPayload {
  shopId: string;
  syncRunId: string;
  phase: SyncRunPhase;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SyncPhaseIngestJobPayload {
  shopId: string;
  syncRunId: string;
  phase: SyncRunPhase;
  bulkResultUrl: string;
}

export const syncPhaseQueue = new Queue<
  SyncPhaseDispatchJobPayload | SyncPhaseIngestJobPayload
>(SYNC_PHASE_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
  },
});

export const syncPhaseQueueEvents = new QueueEvents(SYNC_PHASE_QUEUE_NAME, {
  connection,
});

export async function enqueueSyncPhaseDispatch(
  payload: SyncPhaseDispatchJobPayload,
  options?: JobsOptions,
): Promise<void> {
  await syncPhaseQueue.add(SYNC_PHASE_JOB_DISPATCH, payload, {
    ...options,
    jobId: `dispatch:${payload.syncRunId}`,
  });
}

export async function enqueueSyncPhaseIngest(
  payload: SyncPhaseIngestJobPayload,
  options?: JobsOptions,
): Promise<void> {
  await syncPhaseQueue.add(SYNC_PHASE_JOB_INGEST, payload, {
    ...options,
    jobId: `ingest:${payload.syncRunId}`,
  });
}

export const syncPhaseWorker = new Worker<
  SyncPhaseDispatchJobPayload | SyncPhaseIngestJobPayload
>(
  SYNC_PHASE_QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case SYNC_PHASE_JOB_DISPATCH:
        await dispatchSyncPhase(job.data as SyncPhaseDispatchJobPayload);
        return;

      case SYNC_PHASE_JOB_INGEST:
        await handleSyncPhaseIngest(job.data as SyncPhaseIngestJobPayload);
        return;

      default:
        throw new Error(`Unsupported sync phase job: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: Number(process.env.SYNC_PHASE_WORKER_CONCURRENCY ?? 4),
  },
);

syncPhaseWorker.on("completed", (job) => {
  console.info("[syncPhase.worker] completed", {
    jobId: job.id,
    name: job.name,
  });
});

syncPhaseWorker.on("failed", (job, error) => {
  console.error("[syncPhase.worker] failed", {
    jobId: job?.id,
    name: job?.name,
    error: error.message,
  });
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[syncPhase.worker] shutting down due to ${signal}`);

  await Promise.allSettled([
    syncPhaseWorker.close(),
    syncPhaseQueueEvents.close(),
    syncPhaseQueue.close(),
    connection.quit(),
  ]);

  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));