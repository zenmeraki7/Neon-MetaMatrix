import { errorResponse } from "../utils/responseUtils.js";

function buildValidator(schema, source) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      convert: true,
      stripUnknown: true, // ✅ safer
    });

    if (error) {
      const message = error.details
        .map((detail) => detail.message)
        .join(", ");

      return res
        .status(400)
        .json(errorResponse(message || `Invalid ${source}`));
    }

    req[source] = value;
    return next();
  };
}

// ✅ Named exports (important)
export const validateQuery = (schema) => buildValidator(schema, "query");
export const validateBody = (schema) => buildValidator(schema, "body");