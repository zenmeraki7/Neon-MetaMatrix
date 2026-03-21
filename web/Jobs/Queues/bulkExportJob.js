import dotenv from "dotenv";
dotenv.config();

import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "export_queue";

console.log("🚀 EXPORT QUEUE:", QUEUE_NAME);

export const bulkExportQueue = new Queue(QUEUE_NAME, { connection });

export const addbulkExportJob = async (data) => {
  console.log("📦 ADDING JOB:", data);

  return bulkExportQueue.add("export-products", data, {
    removeOnComplete: true,
    removeOnFail: false,
  });
};