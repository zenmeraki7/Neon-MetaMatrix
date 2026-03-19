import { prisma } from "../config/database.js";

class ExportRepository {
  async createExportHistory(data) {
    return prisma.exportHistory.create({ data });
  }

  async createExportJob(data) {
    return prisma.exportJob.create({ data });
  }

  async findExportHistoryByIdAndShop({ id, shop }) {
    return prisma.exportHistory.findFirst({
      where: {
        id,
        shop,
      },
    });
  }
}

export const exportRepository = new ExportRepository();