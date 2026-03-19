import { prisma } from "../config/database.js";

class ImportRepository {
  async createSpreadsheetFile(data) {
    return prisma.spreadsheetFile.create({ data });
  }
}

export const importRepository = new ImportRepository();