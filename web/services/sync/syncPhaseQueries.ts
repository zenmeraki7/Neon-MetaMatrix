import { SyncRunPhase } from "@prisma/client";

export function buildBulkQueryForPhase(phase: SyncRunPhase): string {
  switch (phase) {
    case SyncRunPhase.BULK_PRODUCTS_CORE:
      return buildProductsCoreBulkQuery();
    case SyncRunPhase.BULK_VARIANTS_CORE:
      return buildVariantsCoreBulkQuery();
    case SyncRunPhase.BULK_COLLECTION_MEMBERSHIP:
      return buildCollectionMembershipBulkQuery();
    case SyncRunPhase.BULK_INVENTORY_LEVELS:
      return buildInventoryLevelsBulkQuery();
    default:
      throw new Error(`Unsupported bulk phase query: ${phase satisfies never}`);
  }
}

export function buildProductsCoreBulkQuery(): string {
  return `
  {
    products {
      edges {
        node {
          id
          legacyResourceId
          title
          handle
          description
          vendor
          productType
          status
          templateSuffix
          tags
          createdAt
          updatedAt
          publishedAt
          featuredMedia {
            ... on MediaImage {
              id
            }
          }
          options {
            name
            position
          }
        }
      }
    }
  }
  `;
}

export function buildVariantsCoreBulkQuery(): string {
  return `
  {
    productVariants {
      edges {
        node {
          id
          legacyResourceId
          title
          sku
          barcode
          price
          compareAtPrice
          taxable
          inventoryPolicy
          inventoryQuantity
          requiresShipping
          weight
          weightUnit
          selectedOptions {
            name
            value
          }
          product {
            id
          }
          inventoryItem {
            id
            tracked
            countryCodeOfOrigin
            harmonizedSystemCode
            unitCost {
              amount
              currencyCode
            }
          }
          updatedAt
        }
      }
    }
  }
  `;
}

export function buildCollectionMembershipBulkQuery(): string {
  return `
  {
    products {
      edges {
        node {
          id
          collections(first: 250) {
            edges {
              node {
                id
                title
                ruleSet {
                  appliedDisjunctively
                }
              }
            }
          }
        }
      }
    }
  }
  `;
}

export function buildInventoryLevelsBulkQuery(): string {
  return `
  {
    inventoryItems {
      edges {
        node {
          id
          variant {
            id
          }
          inventoryLevels(first: 250) {
            edges {
              node {
                updatedAt
                location {
                  id
                  name
                }
                quantities(names: ["available", "on_hand"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
  `;
}