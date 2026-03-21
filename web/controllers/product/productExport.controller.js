import axios from "axios";

import { errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productExportService } from "../../services/product/productExport.service.js";
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

export const handleExportProductsData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productExportService.handleExportProductsData({
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
      source: "POST /api/products/export",
      fallbackMessage: "Failed to start export process",
    });
  }
};

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

export const handleDownloadExportProductsData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await productExportService.handleDownloadExportProductsData({
      session,
      exportHistoryId: req.params.id,
    });

    if (!result) {
      return res.status(404).json(errorResponse("Export history not found"));
    }

    // 🔥 FETCH FILE FROM CLOUDINARY
    const fileResponse = await axios.get(result.fileUrl, {
      responseType: "stream",
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    );

    fileResponse.data.pipe(res);
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

//   res.header("Content-Type", "text/csv");
//   res.attachment(result.filename);

// return res.redirect(result.exportedData);
