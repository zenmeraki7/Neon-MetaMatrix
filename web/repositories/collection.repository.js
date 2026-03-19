import { prisma } from "../config/database.js";

class CollectionRepository {
  async findCollectionsByShop({ shop, search = "", take = 20 }) {
    return prisma.collection.findMany({
      where: {
        shop,
        ...(search
          ? {
              title: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      take,
    });
  }
}

export const collectionRepository = new CollectionRepository();