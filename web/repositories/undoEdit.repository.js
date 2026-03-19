import { prisma } from "../config/database.js";

class UndoEditRepository {
  async findUndoHistoryByIdAndShop({ id, shop }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        id: true,
        status: true,
        undo: true,
      },
    });
  }

  async updateUndoStateByIdAndShop({ id, shop, undo }) {
    return prisma.editHistory.updateMany({
      where: {
        id,
        shop,
      },
      data: {
        undo,
      },
    }).then(async (result) => {
      if (!result?.count) {
        throw new Error("Edit history not found");
      }

      return prisma.editHistory.findFirst({
        where: {
          id,
          shop,
        },
        select: {
          id: true,
        },
      });
    });
  }
}

export const undoEditRepository = new UndoEditRepository();