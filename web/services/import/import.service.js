import fs from "fs/promises";
import { addbulkImportEditJob } from "../../Jobs/Queues/bulkImportEditJob.js";
import { createMultiLanguageForFileEdit } from "../../utils/googleTranslator.js";
import { clearAllCachesForShop, clearKeyCaches } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import { spreadsheetImportRepository } from "../../repositories/spreadsheetImport.repository.js";
import { prisma } from "../../config/database.js";
import { uploadCsvToCloudinary } from "../../utils/uploadCsvToCloudinary.js";

async function safeUnlink(filePath) {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
  } catch {
    // intentionally ignored
  }
}

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeOriginalFileName(name) {
  return String(name ?? "").trim() || "Imported file";
}

function parseColumnMappings(raw) {
  if (!raw) {
    const error = new Error("columnMappings missing");
    error.statusCode = 400;
    throw error;
  }

  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      const error = new Error("Invalid columnMappings");
      error.statusCode = 400;
      throw error;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Invalid columnMappings");
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function hasIdMapping(columnMappings) {
  return Object.values(columnMappings).some(
    (value) => String(value ?? "").trim() === "id",
  );
}

export class ImportService {
  async queueLocalCsvBulkEdit({ session, file, columnMappingsRaw }) {
    const filePath = file?.path;
    const shop = normalizeShop(session?.shop);

    if (!filePath) {
      const error = new Error("CSV file is required");
      error.statusCode = 400;
      throw error;
    }

    const columnMappings = parseColumnMappings(columnMappingsRaw);

    if (!hasIdMapping(columnMappings)) {
      await safeUnlink(filePath);
      const error = new Error("Product ID mapping is required");
      error.statusCode = 400;
      throw error;
    }

    const importHistory =
      await spreadsheetImportRepository.createSpreadsheetFile({
        shop,
        fileUrl: null,
        columnMappings,
        totalRows: 0,
      });

    await addbulkImportEditJob({
      session,
      filePath,
      importHistoryId: importHistory.id,
    });

    await clearAllCachesForShop(shop);

    return importHistory;
  }

  async queueCloudImport({ session, file, columnMappingsRaw }) {
    const filePath = file?.path;

    if (!filePath) {
      const error = new Error("CSV file required");
      error.statusCode = 400;
      throw error;
    }

    const parsedMappings = parseColumnMappings(columnMappingsRaw);

    if (!hasIdMapping(parsedMappings)) {
      await safeUnlink(filePath);
      const error = new Error("Product ID mapping is required");
      error.statusCode = 400;
      throw error;
    }

    const shop = normalizeShop(session?.shop);

    try {
      const fileUrl = await uploadCsvToCloudinary(filePath, "124673");

      const importDoc =
        await spreadsheetImportRepository.createSpreadsheetFile({
          shop,
          columnMappings: parsedMappings,
          fileUrl,
          totalRows: null,
        });

      const multiTitle = createMultiLanguageForFileEdit(
        normalizeOriginalFileName(file?.originalname),
      );

      const newHistory = await prisma.editHistory.create({
        data: {
          shop,
          title: multiTitle,
          editedType: "mixed",
          startedAt: new Date(),
          importFileId: importDoc.id,
          batch: {
            lastProductId: null,
            hasMore: false,
            size: 0,
          },
        },
      });

      await clearKeyCaches(cacheKeys.histories(shop));

      await addbulkImportEditJob({
        historyId: newHistory.id,
        fileUrl,
        columnMappings: parsedMappings,
        session,
      });

      return newHistory;
    } finally {
      await safeUnlink(filePath);
    }
  }
}

export const importService = new ImportService();