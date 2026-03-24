import { Services } from "../services/productService/productFilterService.js";
import { successResponse, errorResponse } from "../utils/responseUtils.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { prisma } from "../config/database.js";

const productService = new Services();

/**
 * GET /api/products
 * Product listing with filters (still backed by your Mongo/PG filter engine in Services)
 * Only tracking (FilterTrack) is converted to Prisma here.
 */
export const getProductsWithQuery = async (req, res) => {
  const session = res.locals.shopify?.session;

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productService.getProductsWithFilters({
      queryParams: req.query,
      filterParams: req.body.filterParams,
      shop: session.shop,
    });

    if (process.env.NODE_ENV === "production") {
      await prisma.filterTrack.create({
        data: {
          shop: session.shop,
          filterParams: req.body?.filterParams || {},
          respondProductCount: result?.count || 0,
          type: "filter",
        },
      });
    }

    return res
      .status(200)
      .json(successResponse("Products fetched successfully", result));
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/products",
    });

    return res.status(500).json(errorResponse("Failed to fetch products"));
  }
};