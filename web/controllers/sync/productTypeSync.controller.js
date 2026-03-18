import { asyncHandler } from "../../utils/asyncHandler.js";
import { logApiError } from "../../utils/errorLogUtils.js";
import { productTypeSyncService } from "../../services/sync/productTypeSync.service.js";
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

export const clearProductTypes = asyncHandler(async (req, res) => {
  const session = assertShopSession(res);

  try {
    await assertNoRunningBulkOperation(session, "QUERY");

    const result = await productTypeSyncService.startProductTypeSync({
      session,
    });

    return res.status(200).send(result);
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/product-types/sync",
    });

    return res.status(getErrorStatusCode(err)).json({
      message: getErrorMessage(err, "Failed to start product type sync"),
    });
  }
});