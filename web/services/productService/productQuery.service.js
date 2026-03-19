import { getCache, setCache } from "../../utils/cacheUtils.js";
import { productRepository } from "../../repositories/product.repository.js";
import {
  buildPrismaSortQuery,
  buildProductPrismaWhere,
} from "./productFilterCompiler.service.js";

function normalizePage(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function normalizeLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

class ProductQueryService {
  async getProductsWithFilters({ queryParams = {}, filterParams = [], shop = null }) {
    const page = normalizePage(queryParams.page, 1);
    const limit = normalizeLimit(queryParams.limit, 20);
    const { sortKey, sortOrder } = queryParams;

    const cacheKey = `${shop}:ProductFetch:${JSON.stringify(queryParams)}:${JSON.stringify(filterParams)}`;
    const cacheData = await getCache(cacheKey);
    if (cacheData) {
      return cacheData;
    }

    const where = buildProductPrismaWhere(filterParams, shop);
    const skip = (page - 1) * limit;
    const orderBy = buildPrismaSortQuery(sortKey, sortOrder);

    const [products, count] = await Promise.all([
      productRepository.findProductsForList({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      productRepository.countByWhere(where),
    ]);

    const returnData = {
      products,
      count,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
        hasNextPage: skip + limit < count,
        hasPrevPage: page > 1,
      },
    };

    await setCache(cacheKey, returnData, 300);
    return returnData;
  }
}

export const productQueryService = new ProductQueryService();