import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in dev; Next.js re-evaluates modules on
// every change and a fresh client per reload exhausts the connection pool.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
