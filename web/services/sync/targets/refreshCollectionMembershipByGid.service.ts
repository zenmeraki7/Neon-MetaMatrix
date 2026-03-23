import { PrismaClient } from "@prisma/client";
import { ShopifyAdminGraphqlClient } from "../../shopify/adminGraphql.client";
import { findShopSyncCredentials } from "../../../repositories/shop.repository";

const prisma = new PrismaClient();

type NodeQueryResponse = {
  node: ProductCollectionNode | CollectionNode | null;
};

type ProductCollectionNode = {
  __typename?: "Product";
  id: string;
  collections?: {
    edges?: Array<{
      node?: {
        id?: string | null;
        title?: string | null;
        ruleSet?: Record<string, unknown> | null;
      } | null;
    }> | null;
  } | null;
};

type CollectionNode = {
  __typename?: "Collection";
  id: string;
  title?: string | null;
  ruleSet?: Record<string, unknown> | null;
  products?: {
    edges?: Array<{
      node?: {
        id?: string | null;
      } | null;
    }> | null;
  } | null;
};

export interface RefreshCollectionMembershipByGidInput {
  shopId: string;
  resourceGid: string;
}

export async function refreshCollectionMembershipByGid(
  input: RefreshCollectionMembershipByGidInput,
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
    NodeQueryResponse,
    { id: string }
  >(COLLECTION_MEMBERSHIP_NODE_QUERY, {
    id: input.resourceGid,
  });

  if (!response.node) {
    return {
      refreshed: true,
      resource: "collection_membership",
      resourceGid: input.resourceGid,
      deleted: true,
      memberships: 0,
    };
  }

  if (response.node.__typename === "Product") {
    const rows = (response.node.collections?.edges ?? [])
      .map((edge) => edge?.node ?? null)
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .map((collection) => ({
        productGid: response.node!.id,
        collectionGid:
          typeof collection.id === "string" && collection.id.trim() !== ""
            ? collection.id
            : null,
        collectionTitle:
          typeof collection.title === "string" && collection.title.trim() !== ""
            ? collection.title
            : null,
        isManual: !Boolean(collection.ruleSet),
      }))
      .filter(
        (
          row,
        ): row is {
          productGid: string;
          collectionGid: string;
          collectionTitle: string | null;
          isManual: boolean;
        } => Boolean(row.collectionGid),
      );

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM product_collection_membership
        WHERE shop_id = ${input.shopId}::uuid
          AND product_gid = ${response.node!.id}
      `;

      for (const row of rows) {
        await tx.$executeRaw`
          INSERT INTO product_collection_membership (
            shop_id,
            product_gid,
            collection_gid,
            collection_title,
            is_manual,
            last_observed_at,
            created_at,
            updated_at
          )
          VALUES (
            ${input.shopId}::uuid,
            ${row.productGid},
            ${row.collectionGid},
            ${row.collectionTitle},
            ${row.isManual},
            NOW(),
            NOW(),
            NOW()
          )
        `;
      }
    });

    return {
      refreshed: true,
      resource: "collection_membership",
      scope: "product",
      resourceGid: input.resourceGid,
      deleted: false,
      memberships: rows.length,
    };
  }

  if (response.node.__typename === "Collection") {
    const collectionId = response.node.id;
    const collectionTitle =
      typeof response.node.title === "string" && response.node.title.trim() !== ""
        ? response.node.title
        : null;
    const isManual = !Boolean(response.node.ruleSet);

    const rows = (response.node.products?.edges ?? [])
      .map((edge) => edge?.node ?? null)
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .map((product) => ({
        productGid:
          typeof product.id === "string" && product.id.trim() !== ""
            ? product.id
            : null,
      }))
      .filter((row): row is { productGid: string } => Boolean(row.productGid));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM product_collection_membership
        WHERE shop_id = ${input.shopId}::uuid
          AND collection_gid = ${collectionId}
      `;

      for (const row of rows) {
        await tx.$executeRaw`
          INSERT INTO product_collection_membership (
            shop_id,
            product_gid,
            collection_gid,
            collection_title,
            is_manual,
            last_observed_at,
            created_at,
            updated_at
          )
          VALUES (
            ${input.shopId}::uuid,
            ${row.productGid},
            ${collectionId},
            ${collectionTitle},
            ${isManual},
            NOW(),
            NOW(),
            NOW()
          )
        `;
      }
    });

    return {
      refreshed: true,
      resource: "collection_membership",
      scope: "collection",
      resourceGid: input.resourceGid,
      deleted: false,
      memberships: rows.length,
    };
  }

  throw new Error(`Unsupported node type for collection membership refresh`);
}

const COLLECTION_MEMBERSHIP_NODE_QUERY = `
query CollectionMembershipNode($id: ID!) {
  node(id: $id) {
    __typename
    ... on Product {
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
    ... on Collection {
      id
      title
      ruleSet {
        appliedDisjunctively
      }
      products(first: 250) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
}
`;