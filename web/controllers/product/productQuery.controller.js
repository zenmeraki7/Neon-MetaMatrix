// web/controllers/product/productQuery.controller.js
import { successResponse, errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productQueryService } from "../../services/product/productQuery.service.js";
import { productMetadataSyncService } from "../../services/product/productMetadataSync.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

function getErrorStatusCode(err, fallbackStatusCode = 500) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : fallbackStatusCode;
}

function getSafeErrorMessage(err, fallbackMessage, statusCode) {
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  if (statusCode < 500 && message) {
    return message;
  }
  return fallbackMessage;
}

function normalizeSearch(search) {
  return typeof search === "string" ? search.trim() : "";
}

function normalizeFilterParams(filterParams) {
  return Array.isArray(filterParams) ? filterParams : [];
}

async function handleControllerError({
  err,
  req,
  res,
  session,
  source,
  fallbackMessage,
  fallbackStatusCode = 500,
}) {
  await logApiError({
    shop: session?.shop,
    err,
    req,
    source,
  });

  const statusCode = getErrorStatusCode(err, fallbackStatusCode);

  return res
    .status(statusCode)
    .json(errorResponse(getSafeErrorMessage(err, fallbackMessage, statusCode)));
}

export const getProductsWithQuery = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    

    const result = await productQueryService.getProductsWithQuery({
      shop: session.shop,
      queryParams: req.query || {},
      filterParams: normalizeFilterParams(req.body?.filterParams),
      environment: process.env.NODE_ENV,
    });

    return res
      .status(200)
      .json(successResponse("Products fetched successfully", result));
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "GET /api/products",
      fallbackMessage: "Failed to fetch products",
    });
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
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "GET /api/product-types",
      fallbackMessage: "Failed to fetch product types",
    });
  }
};

export const checkEditStatus = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const history = await productQueryService.checkEditStatus({
      shop: session.shop,
      historyId: req.params.id,
    });

    if (!history) {
      return res.status(200).json({
        status: "not_found",
        message: "No history found",
      });
    }

    return res.status(200).json({
      rootObjectCount: history.processedCount,
      totalItems: history.totalItems,
      duration: history.durationMs,
    });
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "GET /api/edit-status/:id",
      fallbackMessage: "Failed to fetch edit status",
    });
  }
};

export const clearProductTypes = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productMetadataSyncService.clearProductTypes({
      session,
    });

    return res.status(200).json(result);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/product-types/clear",
      fallbackMessage: "Failed to refresh product types",
    });
  }
};