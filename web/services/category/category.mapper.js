function normalizeString(value) {
  return String(value ?? "").trim();
}

export function mapShopifyTaxonomyCategories(
  edges = [],
  { isNameOnly = false } = {},
) {
  if (!Array.isArray(edges) || edges.length === 0) {
    return [];
  }

  return edges
    .map((edge) => edge?.node)
    .filter((node) => node && node.id)
    .map((node) => {
      const id = normalizeString(node.id);

      const rawTitle = isNameOnly ? node.name : node.fullName;
      const title = normalizeString(rawTitle);

      return {
        id,
        title,
      };
    })
    .filter((item) => item.id && item.title);
}