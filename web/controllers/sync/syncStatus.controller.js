import { logApiError } from "../../utils/errorLogUtils.js";
import { getShopSession } from "../../services/shared/session.service.js";
import { syncStatusService } from "../../services/sync/syncStatus.service.js";

function normalizeShop(shop) {
  return String(shop ?? "").trim();
}

function getErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getDefaultErrorPayload(error) {
  const message = String(error?.message ?? "").trim();

  if (getErrorStatusCode(error) === 400) {
    return {
      error: message || "Shop is required",
    };
  }

  return {
    error: "Internal Server Error",
  };
}

export const getSyncStatus = async (req, res) => {
  const session = getShopSession(res);
  const shop = normalizeShop(session?.shop || req?.query?.shop);

  try {
    const result = await syncStatusService.getSyncStatus(shop);
    return res.status(200).json(result.payload);
  } catch (error) {
    await logApiError({
      shop: session?.shop || shop,
      err: error,
      req,
      source: "sync.syncStatus.controller.getSyncStatus",
    });

    return res.status(getErrorStatusCode(error)).json(
      error?.payload || getDefaultErrorPayload(error),
    );
  }
};