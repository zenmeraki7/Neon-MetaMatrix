// web/routes/productRoutes.js
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

router.post("/get-all", validateQuery(productQuerySchema), getProductsWithQuery);

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