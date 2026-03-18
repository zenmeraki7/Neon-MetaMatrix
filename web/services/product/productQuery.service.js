import { Services } from "../../services/productService/productFilterService.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { productRepository } from "../../repositories/product.repository.js";
import { filterTrackRepository } from "../../repositories/filterTrack.repository.js";
import { cacheKeys } from "../../cache/cacheKeys.js";

const filterService = new Services();

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeSearch(search = "") {
  return String(search ?? "").trim();
}

function isProductionEnvironment(environment) {
  return String(environment ?? "").trim().toLowerCase() === "production";
}

function normalizeFilterParams(filterParams) {
  if (filterParams == null) {
    return {};
  }

  return filterParams;
}

export class ProductQueryService {
  async getProductsWithQuery({ shop, queryParams, filterParams, environment }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedFilterParams = normalizeFilterParams(filterParams);

    const result = await filterService.getProductsWithFilters({
      queryParams,
      filterParams: normalizedFilterParams,
      shop: normalizedShop,
    });

    if (isProductionEnvironment(environment)) {
      await filterTrackRepository.createFilterTrack({
        shop: normalizedShop,
        filterParams: normalizedFilterParams,
        respondProductCount: Number(result?.count ?? 0),
        type: "filter",
      });
    }

    return result;
  }

  async getProductTypes({ shop, search = "" }) {
    const normalizedShop = normalizeShop(shop);
    const normalizedSearch = normalizeSearch(search);
    const cacheKey = cacheKeys.productTypes(normalizedShop, normalizedSearch);

    const cached = await getCache(cacheKey);

    if (Array.isArray(cached)) {
      return {
        fromCache: true,
        data: cached,
      };
    }

    const rows = await productRepository.getDistinctProductTypes({
      shop: normalizedShop,
      search: normalizedSearch,
      take: 20,
    });

    const productTypes = rows
      .filter((row) => row?.productType)
      .map((row) => ({ title: row.productType }));

    await setCache(cacheKey, productTypes, 300);

    return {
      fromCache: false,
      data: productTypes,
    };
  }

  getProductPrismaWhere(filterParams, shop) {
    return filterService.getProductPrismaWhere(
      normalizeFilterParams(filterParams),
      normalizeShop(shop),
    );
  }
}

export const productQueryService = new ProductQueryService();