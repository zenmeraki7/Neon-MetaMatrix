import shopify from "../../shopify.js";
import CacheService from "../../utils/cacheService.js";
import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import {
  bulkOperationMutation,
  getProductSetMutation,
  PRODUCT_SET_MODE,
  stagesUploadMutation,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
  "mixed",
]);

const VARIANT_LEVEL_FIELDS = new Set([
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

function isVariantLevelField(field) {
  if (FIELD_CONFIGS?.[field]?.isVariantLevel) return true;
  return VARIANT_LEVEL_FIELDS.has(field);
}

function resolveMutationMode(field) {
  if (field === "deleteProducts") {
    return PRODUCT_SET_MODE.PRODUCT_DELETE;
  }

  if (OPTION_NAME_FIELDS.has(field)) {
    return PRODUCT_SET_MODE.BOTH;
  }

  if (isVariantLevelField(field)) {
    return PRODUCT_SET_MODE.VARIANT_ONLY;
  }

  return PRODUCT_SET_MODE.PRODUCT_ONLY;
}

export class ProductBulkMutationService {
  constructor(session) {
    this.session = session;
    this.client = new shopify.api.clients.Graphql({ session });
  }

  async runBulkOperation({ formattedProducts, field }) {
    const operationName = `bulkEditProducts_${Date.now()}`;
    const mode = resolveMutationMode(field);

    const stagedRes = await this.client.query({
      data: {
        query: stagesUploadMutation,
        variables: {
          input: [
            {
              filename: operationName,
              mimeType: "text/jsonl",
              resource: "BULK_MUTATION_VARIABLES",
              httpMethod: "POST",
            },
          ],
        },
      },
    });

    const stagedTopLevelErrors = stagedRes?.body?.errors || [];
    if (stagedTopLevelErrors.length > 0) {
      throw new Error(
        stagedTopLevelErrors[0]?.message || "Shopify staged upload request failed",
      );
    }

    const stagedUserErrors =
      stagedRes?.body?.data?.stagedUploadsCreate?.userErrors || [];
    if (stagedUserErrors.length > 0) {
      throw new Error(
        `Shopify API returned errors: ${JSON.stringify(stagedUserErrors)}`,
      );
    }

    const target =
      stagedRes?.body?.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target) {
      throw new Error("Failed to get staged upload target from Shopify");
    }

    const keyUrl = await uploadToShopifyStagedTarget(target, formattedProducts);

    const bulkRes = await this.client.query({
      data: {
        query: bulkOperationMutation,
        variables: {
          mutation: getProductSetMutation(mode),
          stagedUploadPath: keyUrl,
        },
      },
    });

    const bulkTopLevelErrors = bulkRes?.body?.errors || [];
    if (bulkTopLevelErrors.length > 0) {
      throw new Error(
        bulkTopLevelErrors[0]?.message || "Shopify bulk operation request failed",
      );
    }

    const bulkErrors =
      bulkRes?.body?.data?.bulkOperationRunMutation?.userErrors || [];

    if (bulkErrors.length > 0) {
      throw new Error(
        `Bulk operation returned errors: ${JSON.stringify(bulkErrors)}`,
      );
    }

    const result = bulkRes?.body?.data?.bulkOperationRunMutation;
    const bulkOperationId = result?.bulkOperation?.id;

    if (!bulkOperationId) {
      throw new Error("Missing bulkOperationId in Shopify response");
    }

    await CacheService.set(`${this.session.shop}:PRODUCT_UPDATE`, {
      running: true,
    });

    return result;
  }
}