import { getCurrentBulkOperationStatus } from "../../utils/bulkOperationHelper.js";

export async function assertNoRunningBulkOperation(session, type) {
  const result = await getCurrentBulkOperationStatus(session, type);
  const status = String(result?.status ?? "").toUpperCase();

  if (status === "RUNNING") {
    const error = new Error("Another operation is running in background");
    error.statusCode = 400;
    throw error;
  }

  return status;
}