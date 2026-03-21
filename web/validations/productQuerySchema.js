import Joi from "joi";

const ALLOWED_SORT_KEYS = [
  "CREATED_AT",
  "ID",
  "INVENTORY_TOTAL",
  "PRODUCT_TYPE",
  "PUBLISHED_AT",
  "TITLE",
  "UPDATED_AT",
  "VENDOR",
];

const ALLOWED_SORT_ORDERS = ["asc", "desc"];

const productQuerySchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(250)
    .default(20),

  sortKey: Joi.string()
    .trim()
    .valid(...ALLOWED_SORT_KEYS)
    .optional(),

  sortOrder: Joi.string()
    .trim()
    .lowercase()
    .valid(...ALLOWED_SORT_ORDERS)
    .optional(),
}).unknown(false);

export default productQuerySchema;