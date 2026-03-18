import { prisma } from "../config/database.js";

export const spreadsheetImportRepository = {
  async createSpreadsheetFile(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      const error = new Error("Invalid spreadsheet file payload");
      error.statusCode = 400;
      throw error;
    }

    return prisma.spreadsheetFile.create({ data });
  },
};