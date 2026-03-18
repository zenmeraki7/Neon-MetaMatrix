import { asyncHandler } from "../../utils/asyncHandler.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { importService } from "../../services/import/import.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";
import { assertNoRunningBulkOperation } from "../../services/shared/bulkOperationGuard.service.js";

function getErrorStatusCode(err) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

export const csvBulkProductsEdit = asyncHandler(async (req, res) => {
  const session = assertShopSession(res);
  await assertNoRunningBulkOperation(session);

  try {
    const importHistory = await importService.queueLocalCsvBulkEdit({
      session,
      file: req.file,
      columnMappingsRaw: req.body?.columnMappings,
    });

    return res.status(200).json({
      success: true,
      message: "CSV import queued successfully",
      data: importHistory,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/import/csv-bulk-edit",
    });

    return res.status(getErrorStatusCode(err)).json({
      success: false,
      message: getErrorMessage(err, "Failed to queue CSV import"),
    });
  }
});

export const importCsvController = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const history = await importService.queueCloudImport({
      session,
      file: req.file,
      columnMappingsRaw: req.body?.columnMappings,
    });

    return res.json({
      success: true,
      importId: history.id,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/import/csv",
    });

    return res.status(getErrorStatusCode(err)).json({
      message: getErrorMessage(err, "Failed to import CSV"),
    });
  }
};