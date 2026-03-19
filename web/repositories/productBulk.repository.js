import { prisma } from "../config/database.js";

class ProductBulkRepository {
  async countProducts(where) {
    return prisma.product.count({ where });
  }

  async createEditHistory(data) {
    return prisma.editHistory.create({ data });
  }

  async findEditHistoryBatchData({ id, shop }) {
    return prisma.editHistory.findFirst({
      where: {
        id,
        shop,
      },
      select: {
        queryFilter: true,
        batch: true,
        rules: true,
      },
    });
  }

  async findProductsForBatch({ where, include, take }) {
    return prisma.product.findMany({
      where,
      ...(include ? { include } : {}),
      orderBy: { id: "asc" },
      take,
    });
  }

  async findProductsForPreview({ where, include, skip, take }) {
    return prisma.product.findMany({
      where,
      ...(include ? { include } : {}),
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }
}

export const productBulkRepository = new ProductBulkRepository();