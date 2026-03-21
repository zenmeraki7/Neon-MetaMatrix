import { getCache, setCache } from "../../utils/cacheUtils.js";
import { productRepository } from "../../repositories/product.repository.js";
import { editHistoryRepository } from "../../repositories/editHistory.repository.js";
import { filterTrackRepository } from "../../repositories/filterTrack.repository.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import {
  buildPrismaSortQuery,
  buildProductPrismaWhere,
} from "./productFilterCompiler.service.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeSearch(search = "") {
  return String(search ?? "").trim();
}

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

function normalizeFilterParams(filterParams) {
  return Array.isArray(filterParams) ? filterParams : [];
}

function isProductionEnvironment(environment) {
  return String(environment ?? "").trim().toLowerCase() === "production";
}

function buildProductListCacheKey({ shop, queryParams, filterParams }) {
  return `${shop}:ProductFetch:${JSON.stringify(queryParams || {})}:${JSON.stringify(
    filterParams || [],
  )}`;
}

function normalizeProductTypeRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      if (!row) {
        return null;
      }

      if (typeof row.productType === "string" && row.productType.trim()) {
        return { title: row.productType.trim() };
      }

      if (typeof row.title === "string" && row.title.trim()) {
        return { title: row.title.trim() };
      }

      return null;
    })
    .filter(Boolean);
}

function addLegacyProductAliases(products) {
  if (!Array.isArray(products)) {
    return [];
  }

  return products.map((product) => {
    if (!product || typeof product !== "object") {
      return product;
    }

    return {
      ...product,
      shopifyId: product.id,
    };
  });
}

export class ProductQueryService {
  async getProductsWithQuery({
    shop,
    queryParams = {},
    filterParams = [],
    environment,
  }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedFilterParams = normalizeFilterParams(filterParams);
    const page = normalizePage(queryParams?.page, 1);
    const limit = normalizeLimit(queryParams?.limit, 20);
    const { sortKey, sortOrder } = queryParams || {};

    const normalizedQueryParams = {
      ...queryParams,
      page,
      limit,
    };

    const cacheKey = buildProductListCacheKey({
      shop: normalizedShop,
      queryParams: normalizedQueryParams,
      filterParams: normalizedFilterParams,
    });

    const cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const where = buildProductPrismaWhere(
      normalizedFilterParams,
      normalizedShop,
    );
    const orderBy = buildPrismaSortQuery(sortKey, sortOrder);
    const skip = (page - 1) * limit;

    const [products, count] = await Promise.all([
      productRepository.findProductsForList({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      productRepository.countByWhere(where),
    ]);

    const normalizedProducts = addLegacyProductAliases(products);

    const result = {
      products: normalizedProducts,
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

    await setCache(cacheKey, result, 300);

    if (isProductionEnvironment(environment)) {
      if (typeof filterTrackRepository.createFilterTrack === "function") {
        await filterTrackRepository.createFilterTrack({
          shop: normalizedShop,
          filterParams: normalizedFilterParams,
          respondProductCount: Number(result?.count ?? 0),
          type: "filter",
        });
      } else if (typeof filterTrackRepository.create === "function") {
        await filterTrackRepository.create({
          shop: normalizedShop,
          filterParams: normalizedFilterParams,
          respondProductCount: Number(result?.count ?? 0),
          type: "filter",
        });
      }
    }

    return result;
  }

  async getProductTypes({ shop, search = "" }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedSearch = normalizeSearch(search);
    const cacheKey =
      cacheKeys?.productTypes?.(normalizedShop, normalizedSearch) ||
      `${normalizedShop}:productTypes:${normalizedSearch.toLowerCase()}`;

    const cached = await getCache(cacheKey);

    if (Array.isArray(cached)) {
      return {
        fromCache: true,
        data: cached,
      };
    }

    let rows = [];

    if (typeof productRepository.getDistinctProductTypes === "function") {
      rows = await productRepository.getDistinctProductTypes({
        shop: normalizedShop,
        search: normalizedSearch,
        take: 20,
      });
    } else if (typeof productRepository.findDistinctProductTypes === "function") {
      rows = await productRepository.findDistinctProductTypes({
        shop: normalizedShop,
        search: normalizedSearch,
        take: 20,
      });
    }

    const productTypes = normalizeProductTypeRows(rows);

    await setCache(cacheKey, productTypes, 300);

    return {
      fromCache: false,
      data: productTypes,
    };
  }

  async checkEditStatus({ shop, historyId }) {
    const normalizedShop = normalizeShop(shop);

    return editHistoryRepository.findStatusMetricsByShopAndId({
      shop: normalizedShop,
      id: historyId,
    });
  }
}

export const productQueryService = new ProductQueryService();