import { logApiError } from "../../utils/errorLogUtils.js";
import { assertShopSession } from "../../services/shared/session.service.js";
import { syncProgressService } from "../../services/sync/syncProgress.service.js";

function getErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getDefaultErrorPayload(error) {
  const message = String(error?.message ?? "").trim();

  return {
    error: "Internal Server Error",
    message,
  };
}

export const trackProductSync = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await syncProgressService.getProductSyncProgress({
      session,
    });

    return res.status(200).json(result);
  } catch (error) {
    await logApiError({
      shop: session?.shop,
      err: error,
      req,
      source: "sync.syncProgress.controller.trackProductSync",
    });

    return res.status(getErrorStatusCode(error)).json(
      error?.payload || getDefaultErrorPayload(error),
    );
  }
};