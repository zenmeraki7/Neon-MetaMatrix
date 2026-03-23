import { Queue, Worker, JobsOptions, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { bootstrapShopSync } from "../../services/sync/bootstrapShopSync.service";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const SYNC_QUEUE_NAME = "sync-queue";
export const SYNC_JOB_BOOTSTRAP_SHOP = "bootstrap-shop-sync";

export interface BootstrapShopSyncJobPayload {
  shopId: string;
  pollIntervalMs?: number;
  timeoutMsPerPhase?: number;
}

export const syncQueue = new Queue<BootstrapShopSyncJobPayload>(SYNC_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 250,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
  },
});

export const syncQueueEvents = new QueueEvents(SYNC_QUEUE_NAME, { connection });

export async function enqueueBootstrapShopSync(
  payload: BootstrapShopSyncJobPayload,
  options?: JobsOptions,
): Promise<void> {
  await syncQueue.add(SYNC_JOB_BOOTSTRAP_SHOP, payload, {
    jobId: `bootstrap:${payload.shopId}`,
    ...options,
  });
}

export const syncWorker = new Worker<BootstrapShopSyncJobPayload>(
  SYNC_QUEUE_NAME,
  async (job) => {
    switch (job.name) {
      case SYNC_JOB_BOOTSTRAP_SHOP: {
        await bootstrapShopSync({
          shopId: job.data.shopId,
          pollIntervalMs: job.data.pollIntervalMs,
          timeoutMsPerPhase: job.data.timeoutMsPerPhase,
        });
        return;
      }

      default:
        throw new Error(`Unsupported sync job: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: Number(process.env.SYNC_WORKER_CONCURRENCY ?? 2),
    limiter: {
      max: Number(process.env.SYNC_WORKER_RATE_LIMIT_MAX ?? 10),
      duration: Number(process.env.SYNC_WORKER_RATE_LIMIT_WINDOW_MS ?? 1000),
    },
  },
);

syncWorker.on("completed", (job) => {
  console.info("[sync.worker] job completed", {
    jobId: job.id,
    name: job.name,
    shopId: job.data.shopId,
  });
});

syncWorker.on("failed", (job, error) => {
  console.error("[sync.worker] job failed", {
    jobId: job?.id,
    name: job?.name,
    shopId: job?.data.shopId,
    error: error.message,
  });
});

async function shutdown(signal: string): Promise<void> {
  console.info(`[sync.worker] shutting down due to ${signal}`);

  await Promise.allSettled([
    syncWorker.close(),
    syncQueueEvents.close(),
    syncQueue.close(),
    connection.quit(),
  ]);

  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));