// FILE: web/config/database.js
import { PrismaClient } from "../generated/prisma/index.js";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error", "warn"],
  });

// ✅ ADD THIS FUNCTION
async function connectWithRetry() {
  let retries = 5;

  while (retries) {
    try {
      await prisma.$connect();
      console.log("✅ Prisma connected to DB");
      break;
    } catch (err) {
      console.error("❌ Prisma connection failed. Retrying...", err.message);
      retries--;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  if (retries === 0) {
    console.error("💥 Could not connect to DB after retries");
  }
}

// ✅ CALL IT IMMEDIATELY
connectWithRetry();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;