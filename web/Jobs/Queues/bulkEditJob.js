import dotenv from "dotenv";
dotenv.config();

import { Queue } from "bullmq";
import { connection } from "../../Config/redis.js";
import logger from "../../utils/loggerUtils.js";

export const bulkEditQueue = new Queue(process.env.EDIT_QUEUE, { connection });

export const addbulkEditJob = async (data) => {
  try {
    console.log("📤 ADDING JOB TO:", process.env.EDIT_QUEUE);

    const job = await bulkEditQueue.add("AddingBulkEdit", data, {
      removeOnComplete: true,
    });

    return job;
  } catch (error) {
    throw error;
  }
};