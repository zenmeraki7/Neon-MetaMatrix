import { productQueryService } from "./productQuery.service.js";
import {
  buildPrismaSortQuery,
  buildProductPrismaWhere,
  buildPrismaStringFilter,
  buildPrismaNumberFilter,
  buildPrismaBooleanFilter,
  buildPrismaDateFilter,
  buildPrismaArrayStringFilter,
  buildPrismaCollectionFilter,
} from "./productFilterCompiler.service.js";
import { productSyncService } from "./productSync.service.js";
import { productSyncIngestService } from "./productSyncIngest.service.js";

export class Services {
  async getProductsWithFilters({ queryParams = {}, filterParams = [], shop = null }) {
    return productQueryService.getProductsWithFilters({
      queryParams,
      filterParams,
      shop,
    });
  }

  getProductPrismaWhere(filterParams = [], shop) {
    return buildProductPrismaWhere(filterParams, shop);
  }

  buildPrismaSortQuery(sortKey, sortOrder) {
    return buildPrismaSortQuery(sortKey, sortOrder);
  }

  buildPrismaStringFilter(field, operator, value) {
    return buildPrismaStringFilter(field, operator, value);
  }

  buildPrismaNumberFilter(field, operator, value) {
    return buildPrismaNumberFilter(field, operator, value);
  }

  buildPrismaBooleanFilter(field, operator, value) {
    return buildPrismaBooleanFilter(field, operator, value);
  }

  buildPrismaDateFilter(field, operator, value) {
    return buildPrismaDateFilter(field, operator, value);
  }

  buildPrismaArrayStringFilter(field, operator, value) {
    return buildPrismaArrayStringFilter(field, operator, value);
  }

  buildPrismaCollectionFilter(operator, value) {
    return buildPrismaCollectionFilter(operator, value);
  }

  async startBulkOperationToFetchProducts({ session, isInitialSync = false }) {
    return productSyncService.startBulkOperationToFetchProducts({
      session,
      isInitialSync,
    });
  }

  async formatAndSyncProductsToDB({ dataStream, shop, replaceShopData = true }) {
    return productSyncIngestService.formatAndSyncProductsToDB({
      dataStream,
      shop,
      replaceShopData,
    });
  }
}