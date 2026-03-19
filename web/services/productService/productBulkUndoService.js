import { uploadToShopifyStagedTarget } from "../../utils/productBulkEditUtils.js";
import { addbulkUndoJob } from "../../Jobs/Queues/bulkUndoJob.js";
import {
  getProductSetMutation,
  PRODUCT_SET_MODE,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import shopify from "../../shopify.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { FIELD_CONFIGS } from "../../helpers/productBulkOperationHelpers/constants.js";
import { undoEditRepository } from "../../repositories/undoEdit.repository.js";

const OPTION_NAME_FIELDS = new Set([
  "option1Name",
  "option2Name",
  "option3Name",
]);

const OPTION_VALUE_FIELDS = new Set([
  "option1Values",
  "option2Values",
  "option3Values",
]);

function isVariantLevelField(field) {
  return Boolean(FIELD_CONFIGS?.[field]?.isVariantLevel);
}

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveUndoMutationMode(field = "") {
  if (OPTION_NAME_FIELDS.has(field)) {
    return PRODUCT_SET_MODE.BOTH;
  }

  if (isVariantLevelField(field)) {
    return PRODUCT_SET_MODE.VARIANT_ONLY;
  }

  return PRODUCT_SET_MODE.PRODUCT_ONLY;
}

class UndoEditService {
  constructor(session) {
    this.client = new shopify.api.clients.Graphql({ session });
    this.session = session;
    this.errors = [];
    this.changes = [];
  }

  async undoEdit(historyId) {
    const editedHistory = await undoEditRepository.findUndoHistoryByIdAndShop({
      id: historyId,
      shop: this.session.shop,
    });

    if (!editedHistory) {
      throw new Error("Edit history not found");
    }

    const undoData =
      editedHistory.undo && typeof editedHistory.undo === "object"
        ? editedHistory.undo
        : {};

    if (editedHistory.status !== "completed" || undoData.allowed === false) {
      throw new Error("Undo can only be performed on completed edits");
    }

    const updatedHistory = await undoEditRepository.updateUndoStateByIdAndShop({
      id: historyId,
      shop: this.session.shop,
      undo: {
        ...undoData,
        status: "pending",
        durationMs: 0,
        processedCount: 0,
        startedAt: new Date(),
      },
    });

    await clearKeyCaches(`${this.session.shop}:fetchHistories`);
    await clearKeyCaches(`${this.session.shop}:historyDetails:${historyId}`);

    await addbulkUndoJob({
      historyId,
      shop: this.session.shop,
    });

    return {
      data: updatedHistory,
      message: "Undo processing started",
    };
  }

  async undoEditBulkOperation(products, field = "") {
    const operationName = `bulkEditUndoProducts_${Date.now()}`;
    const formattedProducts = [];
    let lastId = null;
    let count = 0;
    const mode = resolveUndoMutationMode(field);

    for (const product of getSafeArray(products)) {
      const payload = {
        id: product?.productId,
      };

      const productFieldChanges = getSafeArray(product?.productFieldChanges);
      const variantFieldChanges = getSafeArray(product?.variantFieldChanges);
      const options = getSafeArray(product?.options);

      if (!payload.id) {
        continue;
      }

      if (productFieldChanges.length > 0) {
        productFieldChanges.forEach((fld) => {
          if (!fld || OPTION_NAME_FIELDS.has(fld.field)) {
            return;
          }

          const fieldPayload = this.getProductFieldPayload(
            fld.field,
            fld.revertValue,
            fld.oldValue,
          );

          Object.assign(payload, fieldPayload);
        });
      }

      if (variantFieldChanges.length > 0) {
        payload.productOptions = options.map((op) => ({
          name: op?.name,
          values: getSafeArray(op?.values).map((val) => ({ name: val })),
        }));

        payload.variants = variantFieldChanges.map((variant) => {
          const variantPayload = {
            id: variant?.variantId,
            optionValues: getSafeArray(variant?.selectedOptions).map((op) => ({
              optionName: op?.name,
              name: op?.value,
            })),
          };

          const changePayload = getSafeArray(variant?.changes).reduce(
            (acc, fld) => {
              if (!fld?.field) {
                return acc;
              }

              acc[fld.field] = fld.revertValue ?? fld.oldValue;
              return acc;
            },
            {},
          );

          if (OPTION_VALUE_FIELDS.has(field)) {
            return variantPayload;
          }

          return { ...variantPayload, ...changePayload };
        });
      }

      formattedProducts.push(JSON.stringify({ productSet: payload }));
      lastId = product?.productId ?? null;
      count += 1;
    }

    const stagedRes = await this.client.query({
      data: {
        query: `
          mutation stagedUploadsCreate {
            stagedUploadsCreate(input: [
              {
                filename: "${operationName}",
                mimeType: "text/jsonl",
                resource: BULK_MUTATION_VARIABLES,
                httpMethod: POST
              }
            ]) {
              stagedTargets {
                url
                resourceUrl
                parameters { name value }
              }
              userErrors { field message }
            }
          }
        `,
      },
    });

    const stagedTopLevelErrors = stagedRes?.body?.errors || [];
    if (stagedTopLevelErrors.length > 0) {
      throw new Error(
        stagedTopLevelErrors[0]?.message || "Shopify staged upload request failed",
      );
    }

    const ndjson = formattedProducts.join("\n");
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

    const keyUrl = await uploadToShopifyStagedTarget(target, ndjson);

    const bulkRes = await this.client.query({
      data: {
        query: `
          mutation {
            bulkOperationRunMutation(
              mutation: ${JSON.stringify(getProductSetMutation(mode))},
              stagedUploadPath: "${keyUrl}"
            ) {
              bulkOperation { id status }
              userErrors { field message }
            }
          }
        `,
      },
    });

    const bulkTopLevelErrors = bulkRes?.body?.errors || [];
    if (bulkTopLevelErrors.length > 0) {
      throw new Error(
        bulkTopLevelErrors[0]?.message || "Shopify bulk mutation request failed",
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

    return {
      bulkOperationId,
      lastProductId: lastId,
      count,
    };
  }

  getProductFieldPayload(field, revertValue, oldValue) {
    const value = revertValue ?? oldValue;

    const fieldMap = {
      "Meta Title": {
        seo: {
          title: value,
        },
      },
      "Meta Description": {
        seo: {
          description: value,
        },
      },
    };

    return fieldMap[field] || { [field]: value };
  }
}

export default UndoEditService;