import { prisma } from "../config/database.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeSearch(search = "") {
  return String(search ?? "").trim();
}

function normalizeTake(value, fallback = 20, max = 1000) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeSkip(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function normalizeWhere(where) {
  return where && typeof where === "object" && !Array.isArray(where)
    ? where
    : {};
}

function normalizeInclude(include) {
  return include && typeof include === "object" && !Array.isArray(include)
    ? include
    : null;
}

export const productRepository = {
  async getDistinctProductTypes({ shop, search = "", take = 20 }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedSearch = normalizeSearch(search);
    const normalizedTake = normalizeTake(take, 20, 100);

    if (!normalizedShop) {
      return [];
    }

    return prisma.product.findMany({
      where: {
        shop: normalizedShop,
        productType: {
          notIn: [null, ""],
          ...(normalizedSearch
            ? {
                contains: normalizedSearch,
                mode: "insensitive",
              }
            : {}),
        },
      },
      select: {
        productType: true,
      },
      distinct: ["productType"],
      orderBy: {
        productType: "asc",
      },
      take: normalizedTake,
    });
  },

  async countByWhere(where) {
    return prisma.product.count({
      where: normalizeWhere(where),
    });
  },

  async findManyForBulkPreview({
    where,
    include,
    skip,
    take,
  }) {
    const normalizedWhere = normalizeWhere(where);
    const normalizedInclude = normalizeInclude(include);
    const normalizedSkip = normalizeSkip(skip, 0);
    const normalizedTake = normalizeTake(take, 20, 500);

    return prisma.product.findMany({
      where: normalizedWhere,
      ...(normalizedInclude ? { include: normalizedInclude } : {}),
      orderBy: { createdAt: "desc" },
      skip: normalizedSkip,
      take: normalizedTake,
    });
  },

  async findManyForBulkBatch({
    where,
    include,
    take,
  }) {
    const normalizedWhere = normalizeWhere(where);
    const normalizedInclude = normalizeInclude(include);
    const normalizedTake = normalizeTake(take, 100, 1000);

    return prisma.product.findMany({
      where: normalizedWhere,
      ...(normalizedInclude ? { include: normalizedInclude } : {}),
      orderBy: { id: "asc" },
      take: normalizedTake,
    });
  },
};