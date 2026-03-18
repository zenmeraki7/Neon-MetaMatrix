import { getCache, setCache } from "../../utils/cacheUtils.js";
import { cacheKeys } from "../../cache/cacheKeys.js";
import { shopifyTaxonomyService } from "../../infra/shopify/taxonomy.service.js";
import { mapShopifyTaxonomyCategories } from "./category.mapper.js";

const CATEGORY_CACHE_TTL_SECONDS = 300;

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeSearch(search) {
  if (typeof search !== "string") {
    return null;
  }

  const trimmed = search.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLimit(first) {
  const parsed = Number.parseInt(first, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(parsed, 250);
}

function isCachedCategoryArray(value) {
  return Array.isArray(value);
}

export class CategoryService {
  async getAllCategories({ session, isNameOnly = false, search, first = 20 }) {
    const shop = normalizeShop(session?.shop);
    const normalizedSearch = normalizeSearch(search);
    const normalizedFirst = normalizeLimit(first);
    const normalizedIsNameOnly = Boolean(isNameOnly);

    const cacheKey = cacheKeys.categories(shop, {
      search: normalizedSearch || "",
      isNameOnly: normalizedIsNameOnly,
      first: normalizedFirst,
    });

    const cachedData = await getCache(cacheKey);

    if (isCachedCategoryArray(cachedData)) {
      return {
        search: normalizedSearch,
        count: cachedData.length,
        data: cachedData,
      };
    }

    const edges = await shopifyTaxonomyService.fetchCategories({
      session,
      first: normalizedFirst,
      search: normalizedSearch,
    });

    const categories = mapShopifyTaxonomyCategories(edges, {
      isNameOnly: normalizedIsNameOnly,
    });

    await setCache(cacheKey, categories, CATEGORY_CACHE_TTL_SECONDS);

    return {
      search: normalizedSearch,
      count: categories.length,
      data: categories,
    };
  }
}

export const categoryService = new CategoryService();