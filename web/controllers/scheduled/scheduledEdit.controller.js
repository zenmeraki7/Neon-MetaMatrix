import { logApiError } from "../../utils/errorLogUtils.js";
import { scheduledEditService } from "../../services/scheduled/scheduledEdit.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

function getErrorStatusCode(err) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

export const createScheduledEdit = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const history = await scheduledEditService.createScheduledEdit({
      session,
      body: req.body,
      subscription: req.subscription,
    });

    return res.status(201).json({
      message: "Scheduled successfully",
      history,
    });
  } catch (err) {
    const errorCode = String(err?.code ?? "").trim();

    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "POST /api/scheduled-edit",
    });

    return res.status(getErrorStatusCode(err)).json({
      ...(errorCode ? { success: false, code: errorCode } : {}),
      error: getErrorMessage(err, "Failed to create scheduled edit"),
      ...(errorCode === "PRODUCT_LIMIT_EXCEEDED"
        ? { message: getErrorMessage(err, "Failed to create scheduled edit") }
        : {}),
    });
  }
};