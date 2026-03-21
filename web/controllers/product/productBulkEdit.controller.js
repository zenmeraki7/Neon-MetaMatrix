// web/controllers/product/productBulkEdit.controller.js
import { errorResponse } from "../../utils/responseUtils.js";
import { translatedEditHistoryStatuses } from "../../Config/constants.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productBulkEditService } from "../../services/product/productBulkEdit.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

import { shopOperationLockService } from "../../services/shared/shopOperationLock.service.js";

function getLang(req) {
  return typeof req?.query?.lang === "string" && req.query.lang.trim()
    ? req.query.lang.trim()
    : "en";
}

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

export const handleBulkEditProduct = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);
    const lang = getLang(req);

    const result = await productBulkEditService.handleBulkEditProduct({
      session,
      body: req.body,
      subscription: req.subscription,
    });

    if (!result) {
      return res.status(500).json({
        message: "Bulk edit failed — no result returned.",
      });
    }

    return res.status(200).json({
      id: result.id,
      title: result.title,
      status:
        translatedEditHistoryStatuses[result.status]?.[lang] || result.status,
      processedCount: result.processedCount,
      totalItems: result.totalItems,
      duration: result.durationMs,
      field: result.field,
      shop: session.shop,
    });
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/bulk-edit",
      fallbackMessage:
        "An unexpected error occurred. Please try again later.",
      fallbackStatusCode: 400,
    });
  }
};

export const trackEditPreview = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productBulkEditService.trackEditPreview({
      session,
      body: req.body,
      lang: getLang(req),
      subscription: req.subscription,
      environment: process.env.NODE_ENV,
    });

    return res.status(200).json(result);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/edit-preview",
      fallbackMessage: "Failed to track edit preview",
    });
  }
};

export const undoEdit = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productBulkEditService.undoEdit({
      session,
      historyId: req.params.id,
    });

    return res.status(200).json(result.data);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/undo-edit/:id",
      fallbackMessage: "Failed to undo edit",
    });
  }
};