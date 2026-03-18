import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";

function normalizeField(field) {
  return String(field ?? "").trim();
}

export const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

export const VARIANT_LEVEL_FIELDS = new Set([
  "price",
  "barcode",
  "sku",
  "inventory",
  "taxable",
  "compareAtPrice",
  "option1Values",
  "option2Values",
  "option3Values",
  "inventoryPolicy",
  "cost",
  "requiresShipping",
  "weight",
  "weightUnit",
]);

export function isVariantLevelField(field) {
  const normalizedField = normalizeField(field);

  if (!normalizedField) {
    return false;
  }

  if (FIELD_CONFIGS?.[normalizedField]?.isVariantLevel === true) {
    return true;
  }

  return VARIANT_LEVEL_FIELDS.has(normalizedField);
}

export function requiresVariants(field) {
  const normalizedField = normalizeField(field);

  if (!normalizedField) {
    return false;
  }

  return (
    OPTION_NAME_FIELDS.has(normalizedField) ||
    isVariantLevelField(normalizedField)
  );
}

export function buildProductInclude(field) {
  if (requiresVariants(field)) {
    return { variants: true };
  }

  return undefined;
}

export function resolveProductSetMode(field, PRODUCT_SET_MODE) {
  const normalizedField = normalizeField(field);

  if (!normalizedField) {
    return PRODUCT_SET_MODE.PRODUCT_ONLY;
  }

  if (normalizedField === "deleteProducts") {
    return PRODUCT_SET_MODE.PRODUCT_DELETE;
  }

  if (OPTION_NAME_FIELDS.has(normalizedField)) {
    return PRODUCT_SET_MODE.BOTH;
  }

  if (isVariantLevelField(normalizedField)) {
    return PRODUCT_SET_MODE.VARIANT_ONLY;
  }

  return PRODUCT_SET_MODE.PRODUCT_ONLY;
}