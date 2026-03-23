import { PrismaClient } from "@prisma/client";
import { ShopifyAdminGraphqlClient } from "../../shopify/adminGraphql.client";
import { findShopSyncCredentials } from "../../../repositories/shop.repository";

const prisma = new PrismaClient();

type InventoryItemQueryResponse = {
  inventoryItem: InventoryItemNode | null;
};

type InventoryItemNode = {
  id: string;
  variant?: { id?: string | null } | null;
  inventoryLevels?: {
    edges?: Array<{
      node?: {
        updatedAt?: string | null;
        location?: {
          id?: string | null;
          name?: string | null;
        } | null;
        quantities?: Array<{
          name?: string | null;
          quantity?: number | null;
        }> | null;
      } | null;
    }> | null;
  } | null;
};

export interface RefreshInventoryItemByGidInput {
  shopId: string;
  inventoryItemGid: string;
}

export async function refreshInventoryItemByGid(
  input: RefreshInventoryItemByGidInput,
): Promise<Record<string, unknown>> {
  const shop = await findShopSyncCredentials(input.shopId);
  if (!shop) {
    throw new Error(`Shop not found: ${input.shopId}`);
  }

  const client = new ShopifyAdminGraphqlClient({
    shopDomain: shop.shopDomain,
    accessToken: shop.accessToken,
    apiVersion: shop.apiVersion,
  });

  const response = await client.request<
    InventoryItemQueryResponse,
    { id: string }
  >(INVENTORY_ITEM_BY_ID_QUERY, {
    id: input.inventoryItemGid,
  });

  if (!response.inventoryItem) {
    await prisma.$executeRaw`
      DELETE FROM inventory_level_mirror
      WHERE shop_id = ${input.shopId}::uuid
        AND inventory_item_gid = ${input.inventoryItemGid}
    `;

    return {
      refreshed: true,
      resource: "inventory_item",
      inventoryItemGid: input.inventoryItemGid,
      deleted: true,
      inventoryLevels: 0,
    };
  }

  const variantGid =
    typeof response.inventoryItem.variant?.id === "string" &&
    response.inventoryItem.variant.id.trim() !== ""
      ? response.inventoryItem.variant.id
      : null;

  const rows = (response.inventoryItem.inventoryLevels?.edges ?? [])
    .map((edge) => edge?.node ?? null)
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => ({
      inventoryItemGid: response.inventoryItem!.id,
      variantGid,
      locationGid:
        typeof node.location?.id === "string" && node.location.id.trim() !== ""
          ? node.location.id
          : null,
      locationName:
        typeof node.location?.name === "string" && node.location.name.trim() !== ""
          ? node.location.name
          : null,
      available: extractQuantity(node.quantities, "available"),
      onHand: extractQuantity(node.quantities, "on_hand"),
      updatedAtShopify: parseNullableDate(node.updatedAt),
      lastObservedAt: new Date(),
    }))
    .filter((row): row is Omit<typeof row, "locationGid"> & { locationGid: string } => Boolean(row.locationGid));

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM inventory_level_mirror
      WHERE shop_id = ${input.shopId}::uuid
        AND inventory_item_gid = ${input.inventoryItemGid}
    `;

    for (const row of rows) {
      await tx.$executeRaw`
        INSERT INTO inventory_level_mirror (
          shop_id,
          inventory_item_gid,
          variant_gid,
          location_gid,
          location_name,
          available,
          on_hand,
          updated_at_shopify,
          last_observed_at,
          created_at,
          updated_at
        )
        VALUES (
          ${input.shopId}::uuid,
          ${row.inventoryItemGid},
          ${row.variantGid},
          ${row.locationGid},
          ${row.locationName},
          ${row.available},
          ${row.onHand},
          ${row.updatedAtShopify},
          ${row.lastObservedAt},
          NOW(),
          NOW()
        )
      `;
    }

    if (variantGid) {
      await tx.$executeRaw`
        UPDATE variant_mirror
        SET
          inventory_quantity_rollup = COALESCE((
            SELECT SUM(COALESCE(available, 0))
            FROM inventory_level_mirror il
            WHERE il.shop_id = ${input.shopId}::uuid
              AND il.variant_gid = ${variantGid}
          ), 0),
          updated_at = NOW()
        WHERE shop_id = ${input.shopId}::uuid
          AND variant_gid = ${variantGid}
      `;

      await tx.$executeRaw`
        UPDATE product_mirror p
        SET
          total_inventory_rollup = COALESCE((
            SELECT SUM(COALESCE(v.inventory_quantity_rollup, 0))
            FROM variant_mirror v
            WHERE v.shop_id = ${input.shopId}::uuid
              AND v.product_gid = p.product_gid
              AND v.deleted_at IS NULL
          ), 0),
          updated_at = NOW()
        WHERE p.shop_id = ${input.shopId}::uuid
          AND p.product_gid = (
            SELECT vm.product_gid
            FROM variant_mirror vm
            WHERE vm.shop_id = ${input.shopId}::uuid
              AND vm.variant_gid = ${variantGid}
            LIMIT 1
          )
      `;
    }
  });

  return {
    refreshed: true,
    resource: "inventory_item",
    inventoryItemGid: input.inventoryItemGid,
    deleted: false,
    inventoryLevels: rows.length,
  };
}

function extractQuantity(
  quantities: Array<{ name?: string | null; quantity?: number | null }> | null | undefined,
  targetName: string,
): number | null {
  if (!Array.isArray(quantities)) return null;
  const match = quantities.find((item) => item?.name === targetName);
  return typeof match?.quantity === "number" ? match.quantity : null;
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const INVENTORY_ITEM_BY_ID_QUERY = `
query InventoryItemById($id: ID!) {
  inventoryItem(id: $id) {
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
`;