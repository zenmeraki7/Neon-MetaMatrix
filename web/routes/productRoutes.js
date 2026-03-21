import express from "express";

import {
  getProductsWithQuery,
  getProductTypes,
  clearProductTypes,
  checkEditStatus,
} from "../controllers/product/productQuery.controller.js";

import {
  handleBulkEditProduct,
  trackEditPreview,
  undoEdit,
} from "../controllers/product/productBulkEdit.controller.js";

import {
  createProductExport,
  handleDownloadExportProductsData,
  handleExportProductsData,
} from "../controllers/product/productExport.controller.js";

import {
  csvBulkProductsEdit,
  importCsvController,
} from "../controllers/product/productImport.controller.js";

import { createScheduledEdit } from "../controllers/scheduled/scheduledEdit.controller.js";

import {
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
} from "../middleware/subscriptionMiddleware.js";
import productQuerySchema from "../validations/productQuerySchema.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { productExportSchema } from "../validations/productExportQuerySchema.js";
import { uploadCsv } from "../middleware/uploadCsv.js";

const router = express.Router();

function validateProductFilterParams(req, res, next) {
  if (req.body === undefined || req.body === null) {
    req.body = {};
    return next();
  }

  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: "Invalid request body",
    });
  }

  const { filterParams } = req.body;

  if (filterParams === undefined) {
    req.body.filterParams = [];
    return next();
  }

  if (!Array.isArray(filterParams)) {
    return res.status(400).json({
      success: false,
      message: "filterParams must be an array",
    });
  }

  for (const filter of filterParams) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      return res.status(400).json({
        success: false,
        message: "Each filter must be an object",
      });
    }

    if (filter.field !== undefined && typeof filter.field !== "string") {
      return res.status(400).json({
        success: false,
        message: "Each filter field must be a string",
      });
    }

    if (
      filter.operator !== undefined &&
      typeof filter.operator !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Each filter operator must be a string",
      });
    }
  }

  return next();
}

router.post(
  "/get-all",
  validateQuery(productQuerySchema),
  validateProductFilterParams,
  getProductsWithQuery,
);

router.post(
  "/export",
  handleExportProductsData,
);

router.post(
  "/export/create",
  validateQuery(productExportSchema),
  createProductExport,
);

router.get(
  "/download-export/:id",
  handleDownloadExportProductsData,
);

router.get("/product-type-all", getProductTypes);
router.get("/product-type-refresh", clearProductTypes);

router.post("/edit-preview", subscriptionMiddleware, trackEditPreview);
router.get("/bulk-edit-status/:id", checkEditStatus);

router.post(
  "/update",
  subscriptionMiddleware,
  handleBulkEditProduct,
);

router.put("/undo-edit/:id", undoEdit);

router.post(
  "/schedule-task",
  subscriptionMiddleware,
  requirePaidPlanMiddleware,
  createScheduledEdit,
);

router.post(
  "/csv/bulk-edit",
  uploadCsv.single("file"),
  csvBulkProductsEdit,
);

router.post(
  "/csv/import",
  uploadCsv.single("file"),
  importCsvController,
);

export default router;