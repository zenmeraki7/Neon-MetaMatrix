import { logApiError } from "../../utils/errorLogUtils.js";
import { categoryService } from "../../services/category/category.service.js";
import { assertShopSession } from "../../services/shared/session.service.js";

function parseBooleanFlag(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function getErrorStatusCode(err) {
  const statusCode = Number(err?.statusCode);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 500;
}

function getErrorMessage(err, fallbackMessage) {
  const message = String(err?.message ?? "").trim();
  return message || fallbackMessage;
}

export const getAllCategories = async (req, res) => {
  let session = null;

  try {
    session = assertShopSession(res);

    const result = await categoryService.getAllCategories({
      session,
      isNameOnly: parseBooleanFlag(req.query?.isNameOnly),
      search: req.query?.search,
      first: req.query?.first,
    });

    return res.status(200).json({
      success: true,
      search: result.search,
      count: result.count,
      data: result.data,
    });
  } catch (err) {
    await logApiError({
      shop: session?.shop,
      err,
      req,
      source: "category.controller.getAllCategories",
    });

    return res.status(getErrorStatusCode(err)).json({
      success: false,
      message: getErrorMessage(err, "Failed to fetch categories"),
    });
  }
};