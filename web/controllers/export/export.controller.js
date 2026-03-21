// web/controllers/product/productExport.controller.js

import { errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productExportService } from "../../services/product/productExport.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";
import { shopOperationLockService } from "../../services/shared/shopOperationLock.service.js";

// =========================
// COMMON ERROR HELPERS
// =========================
function getErrorStatusCode(err, fallbackStatusCode = 500) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : fallbackStatusCode;
}

function getSafeErrorMessage(err, fallbackMessage, statusCode) {
  const message = typeof err?.message === "string" ? err.message.trim() : "";
  if (statusCode < 500 && message) return message;
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

// =========================
// EXPORT PRODUCTS (FIXED)
// =========================
export const handleExportProductsData = async (req, res) => {
  let session = null;
  let token = null;

  const scope = "product-export"; // 🔥 different scope

  try {
    session = assertShopSession(res);
    const shop = session.shop;

    // 🔒 LOCK START
    const lock = await shopOperationLockService.acquireOperation({
      shop,
      scope,
      payload: req.body,
      lockTtlSeconds: 120,
    });

    token = lock.token;

    // 🔁 Replay request
    if (lock.replay) {
      return res.status(200).json({
        success: true,
        message: "Already processed",
        data: lock.result,
      });
    }

    // 🚀 ORIGINAL SERVICE CALL
    const result = await productExportService.handleExportProductsData({
      session,
      body: req.body,
    });

    // 🔒 LOCK COMPLETE
    await shopOperationLockService.completeOperation({
      shop,
      scope,
      token,
      result,
    });

    return res.status(200).json(result);

  } catch (err) {

    // 🚨 HANDLE 409
    if (err?.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: err.message,
      });
    }

    // 🧹 RELEASE LOCK
    if (token) {
      await shopOperationLockService.releaseOperation({
        shop: session?.shop,
        scope,
        token,
      });
    }

    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/products/export",
      fallbackMessage: "Failed to start export process",
    });
  }
};

// =========================
// CREATE EXPORT JOB
// =========================
export const createProductExport = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productExportService.createProductExport({
      session,
      body: req.body,
    });

    return res.status(200).json(result);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/products/export/create",
      fallbackMessage: "Failed to create export job",
    });
  }
};

// =========================
// DOWNLOAD EXPORT
// =========================
export const handleDownloadExportProductsData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result =
      await productExportService.handleDownloadExportProductsData({
        session,
        exportHistoryId: req.params.id,
      });

    if (!result) {
      return res.status(404).json(errorResponse("Export history not found"));
    }

    res.header("Content-Type", "text/csv");
    res.attachment(result.filename);

return res.redirect(result.exportedData);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "GET /api/products/download-export/:id",
      fallbackMessage: "Failed to download export file",
    });
  }
};