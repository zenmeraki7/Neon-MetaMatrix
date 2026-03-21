import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connection } from "../../Config/redis.js";
import fs from "fs";
import path from "path";
import os from "os";
import { format } from "@fast-csv/format";
import { prisma } from "../../config/database.js";
import { exportRepository } from "../../repositories/export.repository.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";

const QUEUE_NAME = process.env.EXPORT_QUEUE || "export_queue";

console.log("🔥 EXPORT WORKER STARTED...");
console.log("🔥 QUEUE NAME:", QUEUE_NAME);

const bulkExportWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log("🔥 JOB RECEIVED:", job.data);

    const { historyId, shop, fields = [], filterQuery, filename } = job.data;

    const history = await exportRepository.findExportHistoryByIdAndShop({
      id: historyId,
      shop,
    });

    if (!history) {
      throw new Error("Export history not found");
    }

    const startTime = Date.now();

    try {
      const filePath = path.join(os.tmpdir(), filename);
      const writeStream = fs.createWriteStream(filePath);
      const csvStream = format({ headers: true });

      csvStream.pipe(writeStream);

      let where = {};
      try {
        where = JSON.parse(filterQuery || "{}");
      } catch {}

      where.shop = shop;

      let totalRows = 0;

      const products = await prisma.product.findMany({
        where,
        include: { variants: true },
      });

      for (const product of products) {
        const row = { productId: product.id };

        for (const field of fields) {
          row[field] = product[field] ?? "";
        }

        csvStream.write(row);
        totalRows++;
      }

      csvStream.end();

      await new Promise((res) => writeStream.on("finish", res));

      const fileUrl = await uploadCsvToCloudinary(
        filePath,
        historyId,
        filename
      );

      await fs.promises.unlink(filePath);

      const durationMs = Date.now() - startTime;

      await exportRepository.markExportHistoryCompleted({
        id: historyId,
        shop,
        exportedData: fileUrl,
        totalItems: totalRows,
        duration: `${durationMs} ms`,
      });

      console.log("✅ EXPORT COMPLETED:", historyId);

    } catch (error) {
      console.error("❌ EXPORT FAILED:", error.message);

      await exportRepository.markExportHistoryFailed({
        id: historyId,
        shop,
        errorMessage: error.message,
      });

      throw error;
    }
  },
  { connection }
);

export default bulkExportWorker;