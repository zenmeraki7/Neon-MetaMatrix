import { prisma } from "../config/database.js";

class EditHistoryRepository {
  async create(data) {
    return prisma.editHistory.create({ data });
  }

  async findStatusMetricsByShopAndId({ shop, id }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        processedCount: true,
        totalItems: true,
        durationMs: true,
      },
    });
  }

  async findByIdAndShop({ id, shop, select }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      ...(select ? { select } : {}),
    });
  }
}

export const editHistoryRepository = new EditHistoryRepository();