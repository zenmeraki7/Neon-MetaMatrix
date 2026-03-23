import { JobsOptions, Queue, QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { runDeltaSyncJob } from "../../services/sync/runDeltaSyncJob.service";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const DELTA_SYNC_QUEUE_NAME = "delta-sync-queue";
export const DELTA_SYNC_JOB_RUN = "delta-sync-run";

export interface DeltaSyncJobPayload {
  shopId: string;
  syncRunId: string;
  phase: string;
  resourceGid: string;
  webhookEventId: string;
}

export const deltaSyncQueue = new Queue<DeltaSyncJobPayload>(DELTA_SYNC_QUEUE_NAME, {
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

export const deltaSyncQueueEvents = new QueueEvents(DELTA_SYNC_QUEUE_NAME, {
  connection,
});

export async function enqueueDeltaSyncJob(
  payload: DeltaSyncJobPayload,
  options?: JobsOptions,
): Promise<void> {
  await deltaSyncQueue.add(DELTA_SYNC_JOB_RUN, payload, {
    ...options,
    jobId: `delta:${payload.syncRunId}`,
  });
}

export const deltaSyncWorker = new Worker<DeltaSyncJobPayload>(
  DELTA_SYNC_QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case DELTA_SYNC_JOB_RUN:
        await runDeltaSyncJob(job.data);
        return;
      default:
        throw new Error(`Unsupported delta sync job: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: Number(process.env.DELTA_SYNC_WORKER_CONCURRENCY ?? 8),
  },
);

deltaSyncWorker.on("completed", (job) => {
  console.info("[deltaSync.worker] completed", {
    jobId: job.id,
    syncRunId: job.data.syncRunId,
    phase: job.data.phase,
    resourceGid: job.data.resourceGid,
  });
});

deltaSyncWorker.on("failed", (job, error) => {
  console.error("[deltaSync.worker] failed", {
    jobId: job?.id,
    syncRunId: job?.data.syncRunId,
    phase: job?.data.phase,
    resourceGid: job?.data.resourceGid,
    error: error.message,
  });
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[deltaSync.worker] shutting down due to ${signal}`);

  await Promise.allSettled([
    deltaSyncWorker.close(),
    deltaSyncQueueEvents.close(),
    deltaSyncQueue.close(),
    connection.quit(),
  ]);

  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));