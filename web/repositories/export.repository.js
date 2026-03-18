import { prisma } from "../config/database.js";

function assertCreatePayload(data, message) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
}

export const exportRepository = {
  async createLegacyExportHistory(data) {
    assertCreatePayload(data, "Invalid export history payload");
    return prisma.exportHistory.create({ data });
  },

  async createExportJob(data) {
    assertCreatePayload(data, "Invalid export job payload");
    return prisma.exportJob.create({ data });
  },
};