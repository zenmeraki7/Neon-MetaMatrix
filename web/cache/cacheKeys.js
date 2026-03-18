function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeSearch(search = "", fallback = "") {
  const normalized = String(search ?? "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const cacheKeys = Object.freeze({
  syncDetails(shop) {
    return `${normalizeShop(shop)}:sync_details`;
  },

  exportHistories(shop) {
    return `${normalizeShop(shop)}:fetchExportHistories`;
  },

  exportHistoriesPrefix(shop) {
    return `${normalizeShop(shop)}:fetchExportHistories:`;
  },

  histories(shop) {
    return `${normalizeShop(shop)}:fetchHistories`;
  },

  productTypes(shop, search = "") {
    return `${normalizeShop(shop)}:productTypes:${normalizeSearch(search)}`;
  },

  categories(
    shop,
    { search = "", isNameOnly = false, first = 20 } = {},
  ) {
    const normalizedShop = normalizeShop(shop);
    const normalizedSearch = normalizeSearch(search, "all");
    const normalizedFirst = normalizePositiveInt(first, 20);
    const label = isNameOnly ? "name" : "fullname";

    return `${normalizedShop}:categories:${label}:${normalizedFirst}:${normalizedSearch}`;
  },
});