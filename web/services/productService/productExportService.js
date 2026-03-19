import shopify from "../../shopify.js";
import { Parser } from "json2csv";
import { fieldMappings } from "../../utils/productExportUtils.js";
import { graphqlProductsAllFieldQuery } from "../../graphql/product.js";
import CacheService from "../../utils/cacheService.js";
import { EXPORT_TYPES } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { productExportRepository } from "../../repositories/productExport.repository.js";

function getGraphqlTopLevelErrors(response) {
  return response?.body?.errors || [];
}

function getSafeMessage(err, fallback = "Unknown error") {
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export class ProductExportService {
  constructor(session) {
    this.session = session;
    this.client = new shopify.api.clients.Graphql({ session });
    this.fieldMappings = fieldMappings;
  }

  async _countProducts({ queryFilter = null }) {
    const countData = await this.client.query({
      data: {
        query: `
          query GetProductsCount($query: String) {
            productsCount(query: $query, limit: null) {
              count
            }
          }
        `,
        variables: { query: queryFilter },
      },
    });

    const topLevelErrors = getGraphqlTopLevelErrors(countData);
    if (topLevelErrors.length > 0) {
      throw new Error(
        topLevelErrors[0]?.message || "Failed to count products from Shopify",
      );
    }

    const count = countData?.body?.data?.productsCount?.count;
    return Number.isFinite(count) ? count : 0;
  }

  async fetchProducts({ queryFilter = null, count = 0 }) {
    const cacheKey = `${this.session.shop}:${queryFilter}:export`;
    const cacheData = await CacheService.get(cacheKey);

    if (cacheData) {
      return cacheData;
    }

    let hasNextPage = true;
    let endCursor = null;
    const allProducts = [];
    const maxExpected = Number.isFinite(Number(count)) ? Number(count) : 0;

    while (hasNextPage) {
      const response = await this.client.query({
        data: {
          query: graphqlProductsAllFieldQuery,
          variables: {
            first: 250,
            after: endCursor || null,
            query: queryFilter || null,
          },
        },
      });

      const topLevelErrors = getGraphqlTopLevelErrors(response);
      if (topLevelErrors.length > 0) {
        throw new Error(
          topLevelErrors[0]?.message || "Failed to fetch products from Shopify",
        );
      }

      const productsConnection = response?.body?.data?.products;
      const edges = ensureArray(productsConnection?.edges);

      allProducts.push(...edges);
      hasNextPage = Boolean(productsConnection?.pageInfo?.hasNextPage);
      endCursor = productsConnection?.pageInfo?.endCursor || null;

      if (maxExpected > 0 && allProducts.length >= maxExpected) {
        break;
      }
    }

    await setCache(cacheKey, allProducts, 300);
    return allProducts;
  }

  _checkValidation(count, activePlan) {
    if (activePlan === "Basic (Monthly)") {
      if (count > 50) {
        throw new Error(
          "You are a basic plan user, you can only export 50 products at a time",
        );
      }
      return;
    }

    if (activePlan === "Advanced (Monthly)") {
      if (count > 150) {
        throw new Error(
          "You are an advanced plan user, you can only export 150 products at a time",
        );
      }
    }
  }

  transformToCSV(products, requestedColumns) {
    const csvData = [];

    const getNestedValue = (obj, path, defaultValue = "") =>
      path.reduce(
        (acc, key) =>
          acc && acc[key] !== undefined && acc[key] !== null
            ? acc[key]
            : defaultValue,
        obj,
      );

    const safeSplitPop = (val) => (val ? val.toString().split("/").pop() : "");

    ensureArray(products).forEach((productEdgeOrNode) => {
      const product =
        productEdgeOrNode?.node && typeof productEdgeOrNode.node === "object"
          ? productEdgeOrNode.node
          : productEdgeOrNode;

      const variants = ensureArray(product?.variants);
      const images = ensureArray(product?.media);

      if (variants.length > 0) {
        variants.forEach((variant, index) => {
          const row = {};

          ensureArray(requestedColumns).forEach((column) => {
            const path = this.fieldMappings[column]?.split(".") || [];
            let value = "";

            if (path[0] === "variants") {
              value = getNestedValue(variant, path.slice(1));
            } else if (
              (path[0] === "images" || path[0] === "media") &&
              images.length > 0
            ) {
              value = getNestedValue(images[0], path.slice(1));
            } else {
              value = index === 0 ? getNestedValue(product, path) : "";
            }

            if (column === "Weight") {
              const weight = variant?.inventoryItem?.measurement?.weight;
              value = weight
                ? `${weight.value} ${weight.unit}`
                : "Not Specified";
            }

            if (column === "ProductID") {
              value = index === 0 ? safeSplitPop(product?.id) : "";
            }

            if (column === "VariantID") {
              value = safeSplitPop(value);
            }

            row[column] =
              value !== null && value !== undefined ? value.toString() : "";
          });

          csvData.push(row);
        });
      } else {
        const row = {};

        ensureArray(requestedColumns).forEach((column) => {
          const path = this.fieldMappings[column]?.split(".") || [];
          let value =
            (path[0] === "images" || path[0] === "media") && images.length > 0
              ? getNestedValue(images[0], path.slice(1))
              : getNestedValue(product, path);

          if (column === "VariantID") {
            value = safeSplitPop(value);
          }

          if (column === "ProductID") {
            value = safeSplitPop(product?.id);
          }

          row[column] =
            value !== null && value !== undefined ? value.toString() : "";
        });

        csvData.push(row);
      }
    });

    const parser = new Parser({
      fields: ensureArray(requestedColumns),
    });

    return parser.parse(csvData);
  }

  async getAllExportHistories(lang) {
    const language = lang || "en";
    const cacheKey = `${this.session.shop}:fetchExportHistories:${language}`;

    const cacheHistories = await getCache(cacheKey);
    if (cacheHistories) {
      return cacheHistories;
    }

    const histories = await productExportRepository.findRecentExportJobsByShop({
      shop: this.session.shop,
      take: 10,
    });

    const formattedHistory = histories.map((history) => ({
      ...history,
      type: EXPORT_TYPES[history.type]?.[language] || history.type || "",
    }));

    await setCache(cacheKey, formattedHistory, 300);
    return formattedHistory;
  }

  async getExportHistoryDetails(id) {
    const history = await productExportRepository.findExportHistoryByIdAndShop({
      id,
      shop: this.session.shop,
    });

    if (!history) {
      throw new Error("export history not found");
    }

    return history;
  }
}