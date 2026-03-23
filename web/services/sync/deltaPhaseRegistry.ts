export enum DeltaSyncPhase {
  REFRESH_PRODUCT = "REFRESH_PRODUCT",
  REFRESH_VARIANT = "REFRESH_VARIANT",
  REFRESH_INVENTORY_ITEM = "REFRESH_INVENTORY_ITEM",
  REFRESH_COLLECTION_MEMBERSHIP = "REFRESH_COLLECTION_MEMBERSHIP",
}

export interface DeltaPhaseResolution {
  phase: DeltaSyncPhase;
  resourceGid: string;
}

export function resolveDeltaPhaseFromWebhook(input: {
  topic: string;
  resourceGid: string | null;
}): DeltaPhaseResolution | null {
  if (!input.resourceGid) {
    return null;
  }

  switch (input.topic) {
    case "products/create":
    case "products/update":
    case "products/delete":
      return {
        phase: DeltaSyncPhase.REFRESH_PRODUCT,
        resourceGid: input.resourceGid,
      };

    case "product_variants/create":
    case "product_variants/update":
    case "product_variants/delete":
      return {
        phase: DeltaSyncPhase.REFRESH_VARIANT,
        resourceGid: input.resourceGid,
      };

    case "inventory_items/update":
      return {
        phase: DeltaSyncPhase.REFRESH_INVENTORY_ITEM,
        resourceGid: input.resourceGid,
      };

    case "collections/create":
    case "collections/update":
    case "collections/delete":
    case "collects/create":
    case "collects/delete":
      return {
        phase: DeltaSyncPhase.REFRESH_COLLECTION_MEMBERSHIP,
        resourceGid: input.resourceGid,
      };

    default:
      return null;
  }
}