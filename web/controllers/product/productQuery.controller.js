import { successResponse, errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productQueryService } from "../../services/product/productQuery.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

function getErrorStatusCode(err) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

function normalizeSearch(search) {
  return typeof search === "string" ? search : "";
}

export const getProductsWithQuery = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productQueryService.getProductsWithQuery({
      shop: session.shop,
      queryParams: req.query,
      filterParams: req.body?.filterParams,
      environment: process.env.NODE_ENV,
    });

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

    return res
      .status(getErrorStatusCode(err))
      .json(errorResponse(getErrorMessage(err, "Failed to fetch products")));
  }
};

export const getProductTypes = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productQueryService.getProductTypes({
      shop: session.shop,
      search: normalizeSearch(req.query?.search),
    });

    return res.status(200).json({
      data: result.data,
      message: result.fromCache
        ? "Product types fetched from cache"
        : "Product types fetched from product mirror",
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/product-types",
    });

    return res.status(getErrorStatusCode(err)).json({
      error: getErrorMessage(err, "Failed to fetch product types"),
      message: "Failed to fetch product types",
    });
  }
};