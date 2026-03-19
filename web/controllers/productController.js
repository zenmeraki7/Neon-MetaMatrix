import { asyncHandler } from "../utils/asyncHandler.js";
import { errorResponse } from "../utils/responseUtils.js";
import { translatedEditHistoryStatuses } from "../Config/constants.js";
import { logApiError } from "../utils/errorLogUtils.js";
import { productControllerService } from "../services/productService/productController.service.js";

function getSession(res) {
  return res.locals.shopify?.session || null;
}

function getLang(req) {
  return req.query?.lang || "en";
}

async function handleControllerError({ err, req, res, session, source, fallbackMessage, statusCode = 500 }) {
  await logApiError({
    shop: session?.shop,
    err,
    req,
    source,
  });

  return res.status(statusCode).json(
    errorResponse(
      err?.message && statusCode < 500
        ? err.message
        : fallbackMessage,
    ),
  );
}

/**
 * GET /api/products
 */
export const getProductsWithQuery = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.getProductsWithQuery({
      shop: session.shop,
      queryParams: req.query,
      filterParams: req.body?.filterParams,
      nodeEnv: process.env.NODE_ENV,
    });

    return res.status(200).json({
      success: true,
      message: "Products fetched successfully",
      data: result,
    });
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

export const undoEdit = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.undoEdit({
      session,
      historyId: req.params.id,
    });

    return res.status(200).json(result.data);
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/undo-edit/:id",
      fallbackMessage: "Failed to undo edit",
      statusCode,
    });
  }
};

export const handleBulkEditProduct = async (req, res) => {
  const session = getSession(res);
  const lang = getLang(req);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.handleBulkEditProduct({
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
      statusCode: 400,
    });
  }
};

export const trackEditPreview = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.trackEditPreview({
      session,
      body: req.body,
      lang: getLang(req),
      subscription: req.subscription,
      nodeEnv: process.env.NODE_ENV,
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

export const checkEditStatus = asyncHandler(async (req, res) => {
  const session = getSession(res);

  if (!session?.shop) {
    return res.status(401).json({ error: "Shopify session missing" });
  }

  const history = await productControllerService.checkEditStatus({
    shop: session.shop,
    historyId: req.params.id,
  });

  if (history) {
    return res.status(200).json({
      rootObjectCount: history.processedCount,
      totalItems: history.totalItems,
      duration: history.durationMs,
    });
  }

  return res.status(200).json({
    status: "not_found",
    message: "No history found",
  });
});

export const handleExportProductsData = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.handleExportProductsData({
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
      source: "POST /api/export-products",
      fallbackMessage: "Failed to start export process",
    });
  }
};

export const createProductExport = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await productControllerService.createProductExport({
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
      source: "POST /api/exports/create",
      fallbackMessage: "Failed to create export job",
    });
  }
};

export const handleDownloadExportProductsData = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json(errorResponse("Session expired"));
    }

    const result = await productControllerService.handleDownloadExportProductsData({
      session,
      exportHistoryId: req.params.id,
    });

    if (!result) {
      return res.status(404).json({
        message: "Export history not found",
      });
    }

    res.header("Content-Type", "text/csv");
    res.attachment(result.filename);
    return res.send(result.exportedData);
  } catch (err) {
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "GET /api/export-products/:id/download",
      fallbackMessage: "Failed to download export file",
    });
  }
};

export const getProductTypes = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ message: "Shopify session missing" });
    }

    const result = await productControllerService.getProductTypes({
      shop: session.shop,
      search: req.query?.search || "",
    });

    return res.status(200).json(result);
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

export const clearProductTypes = asyncHandler(async (req, res) => {
  const session = getSession(res);

  if (!session?.shop) {
    return res.status(401).json({ error: "Shopify session missing" });
  }

  const result = await productControllerService.clearProductTypes({ session });

  return res.status(200).send(result);
});

export const csvBulkProductsEdit = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ error: "Shopify session missing" });
    }

    const result = await productControllerService.csvBulkProductsEdit({
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
      statusCode: err?.statusCode || 500,
    });
  }
};

export const importCsvController = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session?.shop) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await productControllerService.importCsvController({
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
      fallbackMessage: err?.message || "Failed to import CSV",
    });
  }
};

export const createScheduledEdit = async (req, res) => {
  const session = getSession(res);

  try {
    if (!session) {
      return res.status(403).json({ error: "Session expired" });
    }

    const result = await productControllerService.createScheduledEdit({
      session,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(201).json(result);
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    return handleControllerError({
      err,
      req,
      res,
      session,
      source: "POST /api/scheduled-edit",
      fallbackMessage: "Failed to create scheduled edit",
      statusCode,
    });
  }
};