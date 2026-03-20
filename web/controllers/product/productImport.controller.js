// web/controllers/product/productImport.controller.js
import { errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productImportService } from "../../services/product/productImport.service.js";
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

export const csvBulkProductsEdit = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productImportService.csvBulkProductsEdit({
      session,
      file: req.file,
      body: req.body,
    });

    return res.status(200).json(result);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/csv-bulk-edit",
      fallbackMessage: "Failed to queue CSV bulk edit",
    });
  }
};

export const importCsvController = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productImportService.importCsvController({
      session,
      file: req.file,
      body: req.body,
    });

    return res.status(200).json(result);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/import-csv",
      fallbackMessage: "Failed to import CSV",
    });
  }
};