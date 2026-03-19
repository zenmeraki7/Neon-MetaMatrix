import { prisma } from "../config/database.js";

class ProductExportRepository {
  async findRecentExportJobsByShop({ shop, take = 10 }) {
    return prisma.exportJob.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async findExportHistoryByIdAndShop({ id, shop }) {
    return prisma.exportHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        id: true,
        shop: true,
        filename: true,
        status: true,
        type: true,
        exportTime: true,
        totalItems: true,
        exportedData: true,
      },
    });
  }
}

export const productExportRepository = new ProductExportRepository();