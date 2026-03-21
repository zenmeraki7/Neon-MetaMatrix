import express from "express";
import { getStoreAccess } from "../controllers/storeController.js";
import { validateQuery } from "../middleware/validateQuery.js";
import { languageSchema } from "../validations/storeAccessSchema.js";

const router = express.Router();

router.get(
  "/details",
  validateQuery(languageSchema), // ✅ correct usage
  getStoreAccess
);

export default router;