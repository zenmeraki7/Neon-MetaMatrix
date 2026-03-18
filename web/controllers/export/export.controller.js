import { errorResponse } from "../../utils/responseUtils.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { exportService } from "../../services/export/export.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

function getErrorStatusCode(err) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

export const handleExportProductsData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const { filterParams, fields, fileName } = req.body ?? {};

    const exportHistory = await exportService.startLegacyExport({
      session,
      filterParams,
      fields,
      fileName,
    });

    return res.status(200).json({
      message: "Exporting started — queued in background",
      data: exportHistory,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/export-products",
    });

    return res
      .status(getErrorStatusCode(err))
      .json(errorResponse(getErrorMessage(err, "Failed to start export process")));
  }
};

export const createProductExport = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const job = await exportService.createExportJob({
      shop: session.shop,
      fields: req.body?.fields,
      fileName: req.body?.fileName,
      filterParams: req.body?.filterParams,
    });

    return res.status(200).json({
      exportJobId: job.id,
      status: job.status,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/exports/jobs",
    });

    return res.status(getErrorStatusCode(err)).json({
      message: getErrorMessage(err, "Failed to create export job"),
    });
  }
};

export const handleDownloadExportProductsData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await exportService.downloadLegacyExport({
      session,
      id: req.params.id,
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
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "GET /api/export-products/:id/download",
    });

    return res
      .status(getErrorStatusCode(err))
      .json(errorResponse(getErrorMessage(err, "Failed to download export file")));
  }
};