import { prisma } from "../config/database.js";

class FilterTrackRepository {
  async create(data) {
    return prisma.filterTrack.create({ data });
  }
}

export const filterTrackRepository = new FilterTrackRepository();