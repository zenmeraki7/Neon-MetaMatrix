import logger from "../../utils/loggerUtils.js";
import dayjs from "dayjs";
import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import { handleSyncOperation } from "../../helpers/webhookHelpers/bulkOperations/productTypeSync.js";
import { logWebhookError } from "../../utils/errorLogUtils.js";

export const bulkOperationQueryWorker = new Worker(
  process.env.BULK_OPERATION_QUERY_QUEUE || "bulk-operation-query",
  async (job) => {
    try {
      const bulkOperationId = job.data?.admin_graphql_api_id;

      if (!bulkOperationId) {
        throw new Error(
          "Missing bulk operation ID in mutation webhook payload",
        );
      }

      await handleSyncOperation(bulkOperationId);

      return { message: "bulk operation completion processing completed" };
    } catch (err) {
      await logWebhookError({
        shop: job.data?.shop || job.data?.shop_domain || "unknown",
        req: job.data,
        source: "bulkOperationQueryWorker",
        err,
      });

      throw err;
    }
  },
  {
    connection,
    concurrency: 1,
  },
);

const logTime = () => `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}]`;

bulkOperationQueryWorker
  .on("error", (err) => {
    logger.error("Queue error in bulk operation completion worker", {
      time: logTime(),
      error: err.message,
      stack: err.stack,
    });
  })
  .on("waiting", (jobId) => {
    logger.debug("Bulk operation completion job waiting", {
      time: logTime(),
      jobId,
    });
  })
  .on("active", (job) => {
    logger.info("Bulk operation completion job started", {
      time: logTime(),
      jobId: job.id,
    });
  })
  .on("completed", (job, result) => {
    logger.info("Bulk operation completion job completed", {
      time: logTime(),
      jobId: job.id,
      result,
    });
  })
  .on("failed", (job, err) => {
    logger.error("Bulk operation completion job failed", {
      time: logTime(),
      jobId: job?.id,
      error: err.message,
      stack: err.stack,
    });
  });