import { errorResponse } from "../../utils/responseUtils.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { bulkEditService } from "../../services/bulkEdit/bulkEdit.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";
import { assertNoRunningBulkOperation } from "../../services/shared/bulkOperationGuard.service.js";

function getErrorStatusCode(err, fallback = 500) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : fallback;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

export const undoEdit = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);
    await assertNoRunningBulkOperation(session);

    const result = await bulkEditService.undoEdit({
      session,
      id: req.params.id,
    });

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/undo-edit/:id",
    });

    return res
      .status(getErrorStatusCode(err))
      .json(errorResponse(getErrorMessage(err, "Failed to undo edit")));
  }
};

export const handleBulkEditProduct = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);
    await assertNoRunningBulkOperation(session);

    const result = await bulkEditService.handleBulkEditProduct({
      session,
      req,
    });

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/bulk-edit",
    });

    return res.status(getErrorStatusCode(err, 400)).json({
      success: false,
      message: getErrorMessage(
        err,
        "An unexpected error occurred. Please try again later.",
      ),
    });
  }
};

export const trackEditPreview = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await bulkEditService.trackEditPreview({
      session,
      body: req.body,
      lang: req.query?.lang || "en",
      subscription: req.subscription,
      environment: process.env.NODE_ENV,
    });

    return res.status(200).json(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/edit-preview",
    });

    return res
      .status(getErrorStatusCode(err))
      .json(errorResponse(getErrorMessage(err, "Failed to track edit preview")));
  }
};

export const checkEditStatus = asyncHandler(async (req, res) => {
  const session = assertShopSession(res);

  const history = await bulkEditService.checkEditStatus({
    shop: session.shop,
    id: req.params.id,
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