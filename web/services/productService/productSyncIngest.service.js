import readline from "readline";
import logger from "../../utils/loggerUtils.js";
import { productRepository } from "../../repositories/product.repository.js";
import { syncRepository } from "../../repositories/sync.repository.js";

class ProductSyncIngestService {
  async formatAndSyncProductsToDB({ dataStream, shop, replaceShopData = true }) {
    return new Promise((resolve, reject) => {
      const PRODUCT_BATCH_SIZE = 1000;

      let productBatch = [];
      let totalProductsProcessed = 0;
      let totalVariantsProcessed = 0;
      const productsMap = new Map();

      const normalizeNullableString = (value) => {
        if (value === undefined || value === null) return null;
        const s = String(value).trim();
        return s === "" ? null : s;
      };

      const normalizeNullableFloat = (value) => {
        if (value === undefined || value === null || value === "") return null;
        const n = Number(value);
        return Number.isNaN(n) ? null : n;
      };

      const normalizeNullableInt = (value) => {
        if (value === undefined || value === null || value === "") return null;
        const n = Number(value);
        return Number.isNaN(n) ? null : Math.trunc(n);
      };

      const normalizeBoolean = (value) =>
        typeof value === "boolean" ? value : null;

      const getOptionNameByPosition = (options = [], position) => {
        const found = options.find((o) => Number(o?.position) === position);
        return normalizeNullableString(found?.name);
      };

      const getOptionValueByIndex = (selectedOptions = [], index) => {
        if (!Array.isArray(selectedOptions) || !selectedOptions[index]) return null;
        return normalizeNullableString(selectedOptions[index]?.value);
      };

      const extractCollections = (collections) => {
        if (!collections) return [];
        if (Array.isArray(collections)) return collections;
        if (Array.isArray(collections.edges)) {
          return collections.edges
            .map((edge) => edge?.node)
            .filter(Boolean)
            .map((node) => ({
              id: node.id,
              title: node.title,
            }));
        }
        return [];
      };

      const extractVariants = (variants) => {
        if (!variants) return [];
        if (Array.isArray(variants)) return variants;
        if (Array.isArray(variants.edges)) {
          return variants.edges.map((edge) => edge?.node).filter(Boolean);
        }
        return [];
      };

      const flattenProduct = (product) => {
        const options = Array.isArray(product.options) ? product.options : [];
        const variants = Array.isArray(product.variants) ? product.variants : [];

        return {
          shop,
          id: product.id,
          title: product.title ?? "",
          handle: normalizeNullableString(product.handle),
          status: product.status ?? "DRAFT",
          productType: normalizeNullableString(product.productType),
          vendor: normalizeNullableString(product.vendor),
          tags: Array.isArray(product.tags) ? product.tags : [],
          templateSuffix: normalizeNullableString(product.templateSuffix),
          description: normalizeNullableString(product.descriptionHtml),
          createdAt: product.createdAt ? new Date(product.createdAt) : null,
          updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
          publishedAt: product.publishedAt ? new Date(product.publishedAt) : null,
          seoTitle: normalizeNullableString(product.seo?.title),
          seoDescription: normalizeNullableString(product.seo?.description),
          totalInventory: normalizeNullableInt(product.totalInventory) ?? 0,
          categoryId: normalizeNullableString(product.category?.id),
          categoryName: normalizeNullableString(product.category?.name),
          featuredImageUrl: normalizeNullableString(
            product.featuredMedia?.preview?.image?.url,
          ),
          featuredImageAltText: normalizeNullableString(
            product.featuredMedia?.alt ||
              product.featuredMedia?.preview?.image?.altText,
          ),
          optionsJson: options,
          collectionsJson: Array.isArray(product.collections)
            ? product.collections
            : [],
          option1Name: getOptionNameByPosition(options, 1),
          option2Name: getOptionNameByPosition(options, 2),
          option3Name: getOptionNameByPosition(options, 3),
          variantCount: variants.length,
          visibleOnlineStore: Boolean(product.onlineStoreUrl),
        };
      };

      const flattenVariant = (productId, variant) => {
        const price = normalizeNullableFloat(variant.price);
        const cost = normalizeNullableFloat(variant.inventoryItem?.unitCost?.amount);

        let profitMargin = null;
        if (price !== null && cost !== null && price > 0) {
          profitMargin = Number((((price - cost) / price) * 100).toFixed(2));
        }

        const selectedOptions = Array.isArray(variant.selectedOptions)
          ? variant.selectedOptions
          : [];

        return {
          shop,
          id: variant.id,
          productId,
          title: normalizeNullableString(variant.title),
          sku: normalizeNullableString(variant.sku),
          barcode: normalizeNullableString(variant.barcode),
          price,
          compareAtPrice: normalizeNullableFloat(variant.compareAtPrice),
          cost,
          inventoryQuantity: normalizeNullableInt(variant.inventoryQuantity),
          inventoryPolicy: normalizeNullableString(variant.inventoryPolicy),
          taxable: normalizeBoolean(variant.taxable),
          taxCode: normalizeNullableString(variant.taxCode),
          weight: normalizeNullableFloat(
            variant.inventoryItem?.measurement?.weight?.value,
          ),
          weightUnit: normalizeNullableString(
            variant.inventoryItem?.measurement?.weight?.unit,
          ),
          countryOfOrigin: normalizeNullableString(
            variant.inventoryItem?.countryCodeOfOrigin,
          ),
          hsTariffCode: normalizeNullableString(
            variant.inventoryItem?.harmonizedSystemCode,
          ),
          position: normalizeNullableInt(variant.position),
          selectedOptionsJson: selectedOptions,
          option1Value: getOptionValueByIndex(selectedOptions, 0),
          option2Value: getOptionValueByIndex(selectedOptions, 1),
          option3Value: getOptionValueByIndex(selectedOptions, 2),
          tracked: normalizeBoolean(variant.inventoryItem?.tracked),
          physicalProduct: normalizeBoolean(
            variant.inventoryItem?.requiresShipping,
          ),
          profitMargin,
        };
      };

      const flushProductsAndVariants = async () => {
        if (productBatch.length === 0) return;

        const currentProducts = productBatch;
        productBatch = [];

        const productRows = [];
        const variantRows = [];

        for (const rawProduct of currentProducts) {
          productRows.push(flattenProduct(rawProduct));

          const rawVariants = Array.isArray(rawProduct.variants)
            ? rawProduct.variants
            : [];

          for (const rawVariant of rawVariants) {
            if (!rawVariant?.id) continue;
            variantRows.push(flattenVariant(rawProduct.id, rawVariant));
          }
        }

        await productRepository.createManyProductsAndVariants({
          productRows,
          variantRows,
        });

        totalProductsProcessed += productRows.length;
        totalVariantsProcessed += variantRows.length;

        if (totalProductsProcessed > 0 && totalProductsProcessed % 5000 === 0) {
          await syncRepository.updateProductInitialSyncProgress({
            shopUrl: shop,
            productInitialSyncProgress: totalProductsProcessed,
          });
        }
      };

      const rl = readline.createInterface({
        input: dataStream,
        crlfDelay: Infinity,
      });

      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const json = JSON.parse(line);

          if (!json.__parentId && json.__typename === "Product") {
            if (!productsMap.has(json.id)) {
              productsMap.set(json.id, {
                ...json,
                variants: extractVariants(json.variants),
                collections: extractCollections(json.collections),
                options: Array.isArray(json.options) ? json.options : [],
                featuredMedia: json.featuredMedia || null,
              });
            }
            return;
          }

          const parent = productsMap.get(json.__parentId);
          if (!parent) return;

          switch (json.__typename) {
            case "ProductVariant":
              parent.variants.push({
                id: json.id,
                title: json.title,
                sku: json.sku,
                barcode: json.barcode,
                price: json.price,
                compareAtPrice: json.compareAtPrice,
                inventoryQuantity: json.inventoryQuantity,
                inventoryPolicy: json.inventoryPolicy,
                taxable: json.taxable,
                taxCode: json.taxCode,
                position: json.position,
                selectedOptions: Array.isArray(json.selectedOptions)
                  ? json.selectedOptions
                  : [],
                inventoryItem: json.inventoryItem || null,
              });
              break;

            case "Collection":
              parent.collections.push({
                id: json.id,
                title: json.title,
              });
              break;

            case "MediaImage":
              parent.featuredMedia = json;
              break;

            default:
              break;
          }
        } catch (err) {
          logger.error("Product sync line parse error", {
            shop,
            error: err.message,
          });
        }
      });

      rl.on("close", async () => {
        try {
          if (replaceShopData) {
            await productRepository.deleteProductsAndVariantsByShop(shop);
          }

          for (const product of productsMap.values()) {
            productBatch.push(product);

            if (productBatch.length >= PRODUCT_BATCH_SIZE) {
              await flushProductsAndVariants();
            }
          }

          await flushProductsAndVariants();

          logger.info("Product sync completed", {
            shop,
            totalProductsProcessed,
            totalVariantsProcessed,
          });

          resolve({
            totalProductsProcessed,
            totalVariantsProcessed,
          });
        } catch (err) {
          reject(err);
        }
      });

      rl.on("error", (err) => {
        logger.error("Product sync readline error", {
          shop,
          error: err.message,
        });
        reject(err);
      });
    });
  }
}

export const productSyncIngestService = new ProductSyncIngestService();