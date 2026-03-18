import shopify from "../../shopify.js";
import {
  getProductSetMutation,
  PRODUCT_SET_MODE,
} from "../../helpers/productBulkOperationHelpers/mutationTemplates.js";
import {
  createBulkEditHistoryAndQueue,
  buildBulkEditHistoryPayload,
} from "../bulkEdit/bulkEditPlanner.service.js";
import { previewBulkEditProducts } from "../bulkEdit/bulkEditPreview.service.js";
import { prepareBulkEditBatch } from "../../workers/bulkEdit/processBatch.service.js";
import { resolveProductSetMode } from "../../domain/productFields/fieldMeta.js";
import { runShopifyBulkMutation } from "../../infra/shopify/bulkMutation.service.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function normalizeRequest(req) {
  return req && typeof req === "object" ? req : {};
}

function buildOperationName(prefix = "bulkEditProducts") {
  return `${prefix}_${Date.now()}`;
}

export default class ProductBulkService {
  constructor(session) {
    this.session = session;
    this.client = new shopify.api.clients.Graphql({ session });
  }

  get shop() {
    return normalizeShop(this.session?.shop);
  }

  async bulkEditProducts(req) {
    const safeReq = normalizeRequest(req);

    return createBulkEditHistoryAndQueue({
      body: safeReq.body,
      shop: this.shop,
      subscription: safeReq.subscription || {},
      session: this.session,
    });
  }

  async _bulkOperationEdit(body, subscription) {
    return buildBulkEditHistoryPayload({
      body,
      shop: this.shop,
      subscription: subscription || {},
    });
  }

  async _bulkOperationHelper({ formattedProducts, field }) {
    const mode = resolveProductSetMode(field, PRODUCT_SET_MODE);
    const mutation = getProductSetMutation(mode);

    return runShopifyBulkMutation({
      client: this.client,
      shop: this.shop,
      operationName: buildOperationName(),
      formattedProducts,
      mutation,
    });
  }

  async _preparingBulkOperation({ historyId }) {
    return prepareBulkEditBatch({
      historyId,
      shop: this.shop,
    });
  }

  async trackEditProducts({
    field,
    editType,
    editValue,
    filterParams,
    searchKey,
    replaceText,
    supportValue,
    page = 1,
    limit = 20,
    lang,
    subscription = {},
  }) {
    return previewBulkEditProducts({
      shop: this.shop,
      field,
      editType,
      editValue,
      filterParams,
      searchKey,
      replaceText,
      supportValue,
      page,
      limit,
      lang,
      subscription: subscription || {},
    });
  }
}