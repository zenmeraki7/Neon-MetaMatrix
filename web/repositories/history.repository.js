import { prisma } from "../config/database.js";

class HistoryRepository {
  async findHistoryCursorRecord({ id, shop }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
  }

  async findEditHistoriesPage({ where, take }) {
    return prisma.editHistory.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        processedCount: true,
        totalItems: true,
        editTime: true,
        shop: true,
        undo: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
  }

  async countEditHistories({ where }) {
    return prisma.editHistory.count({ where });
  }

  async findHistoryDetailsByIdAndShop({ id, shop }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        id: true,
        title: true,
        status: true,
        durationMs: true,
        processedCount: true,
        totalItems: true,
        editTime: true,
        createdAt: true,
        updatedAt: true,
        error: true,
        undo: true,
        type: true,
        shop: true,
        rules: true,
      },
    });
  }

  async findHistoryExistsByIdAndShop({ id, shop }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        id: true,
      },
    });
  }

  async countHistoryChanges({ editHistoryId, shop }) {
    return prisma.changeRecord.count({
      where: {
        editHistoryId,
        shop,
      },
    });
  }

  async findHistoryChangesPage({ editHistoryId, shop, skip, take }) {
    return prisma.changeRecord.findMany({
      where: {
        editHistoryId,
        shop,
      },
      select: {
        id: true,
        title: true,
        productFieldChanges: true,
        variantFieldChanges: true,
        status: true,
        image: true,
        productId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take,
    });
  }
}

export const historyRepository = new HistoryRepository();