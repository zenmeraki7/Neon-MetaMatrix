import { logApiError } from "../../utils/errorLogUtils.js";
import { assertShopSession } from "../../services/shared/session.service.js";
import { assertNoRunningBulkOperation } from "../../services/shared/bulkOperationGuard.service.js";

// ✅ FIXED IMPORT
import { productSyncService } from "../../services/sync/productSync.service.js";

function getErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(error) {
  const message = String(error?.message ?? "").trim();
  return message || "Failed to fetch products";
}

export const syncProductData = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    await assertNoRunningBulkOperation(session, "QUERY");

    // ✅ FIXED FUNCTION NAME
    const result = await productSyncService.startBulkOperationToFetchProducts({
      session,
    });

    return res.status(200).json(result);
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "sync.productSync.controller.syncProductData",
    });

    return res.status(getErrorStatusCode(error)).json({
      error: getErrorMessage(error),
    });
  }
};