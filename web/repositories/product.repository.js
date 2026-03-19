import { prisma } from "../config/database.js";

class ProductRepository {
  async countByWhere(where) {
    return prisma.product.count({ where });
  }

  async findProductsForList({ where, orderBy, skip, take }) {
    return prisma.product.findMany({
      where,
      select: {
        title: true,
        id: true,
        status: true,
        productType: true,
        vendor: true,
        totalInventory: true,
        featuredImageUrl: true,
        categoryName: true,
        handle: true,
        templateSuffix: true,
        variantCount: true,
        visibleOnlineStore: true,
      },
      orderBy,
      skip,
      take,
    });
  }

  async findDistinctProductTypes({ shop, search = "", take = 20 }) {
    const rows = await prisma.product.findMany({
      where: {
        shop,
        NOT: [{ productType: null }, { productType: "" }],
        ...(search
          ? {
              productType: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      select: {
        productType: true,
      },
      distinct: ["productType"],
      orderBy: {
        productType: "asc",
      },
      take,
    });

    return rows.map((row) => ({
      title: row.productType,
    }));
  }

  async createManyProductsAndVariants({ productRows, variantRows }) {
    return prisma.$transaction([
      prisma.product.createMany({
        data: productRows,
        skipDuplicates: true,
      }),
      prisma.variant.createMany({
        data: variantRows,
        skipDuplicates: true,
      }),
    ]);
  }

  async deleteProductsAndVariantsByShop(shop) {
    return prisma.$transaction([
      prisma.variant.deleteMany({
        where: { shop },
      }),
      prisma.product.deleteMany({
        where: { shop },
      }),
    ]);
  }
}

export const productRepository = new ProductRepository();