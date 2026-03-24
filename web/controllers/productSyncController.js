import { asyncHandler } from "../utils/asyncHandler.js";
import { getCurrentBulkOperationStatus } from "../utils/bulkOperationHelper.js";
import shopify from "../shopify.js";
import {
  clearKeyCaches,
  getCache,
  setCache,
} from "../utils/cacheUtils.js";
import { prisma } from "../config/database.js";

export const getProductTypes = async (req, res) => {
  try {
    const { search = "" } = req.query;
    const session = res.locals.shopify?.session;

    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const shop = session.shop;

    const cacheKey = `${shop}:productTypes:${search.toLowerCase()}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({
        data: cached,
        message: "Product types fetched from cache",
      });
    }

    const result = await prisma.product.findMany({
      where: {
        shop,
        NOT: [
          { productType: null },
          { productType: "" },
        ],
        ...(search
          ? {
              productType: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      select: {
        productType: true,
      },
      distinct: ["productType"],
      orderBy: {
        productType: "asc",
      },
      take: 20,
    });

    const productTypes = result.map((r) => ({ title: r.productType }));

    await setCache(cacheKey, productTypes, 300);

    return res.status(200).json({
      data: productTypes,
      message: "Product types fetched from product mirror",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      message: "Failed to fetch product types",
    });
  }
};

export const clearProductTypes = asyncHandler(async (req, res) => {
  const session = res.locals?.shopify?.session;
  if (!session?.shop) {
    return res.status(401).json({ error: "Shopify session missing" });
  }

  const { status } = await getCurrentBulkOperationStatus(session, "QUERY");
  if (status === "RUNNING") {
    return res
      .status(400)
      .json({ message: "Another operation is running in background" });
  }

  const client = new shopify.api.clients.Graphql({ session });

  const BULK_OPERATION_MUTATION = `mutation {
    bulkOperationRunQuery(
      query: """
        {
          products {
            edges {
              node {
                id
                productType
              }
            }
          }
        }
      """
    ) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }`;

  const bulkResponse = await client.query({
    data: {
      query: BULK_OPERATION_MUTATION,
    },
  });

  if (bulkResponse.body.errors) {
    throw new Error(bulkResponse.body.errors[0].message);
  }

  const bulkOperationId =
    bulkResponse.body.data.bulkOperationRunQuery.bulkOperation.id;

  const result = await prisma.store.update({
    where: { shopUrl: session.shop },
    data: {
      isProductTypeSyncing: true,
      lastProductTypeSyncAt: new Date(),
    },
  });

  if (!result) {
    throw new Error("Store not found");
  }

  await prisma.syncHistory.create({
    data: {
      shop: session.shop,
      bulkOperationId,
      status: "processing",
      duration: 0,
      recordCount: 0,
      operationType: "ProductType",
    },
  });

  const cacheKey = `${session.shop}:sync_details`;
  await clearKeyCaches(cacheKey);

  return res.status(200).send({
    message: "productType syncing started",
    operationId: bulkOperationId,
  });
});