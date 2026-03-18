import { prisma } from "../config/database.js";

export const filterTrackRepository = {
  async createFilterTrack(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      const error = new Error("Invalid filter track payload");
      error.statusCode = 400;
      throw error;
    }

    return prisma.filterTrack.create({ data });
  },
};