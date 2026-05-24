import path from "node:path";
import { PrismaClient } from "../../generated/prisma";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};
function resolveDatabaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    return `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
  }

  if (value.startsWith("file:./")) {
    return `file:${path.join(process.cwd(), value.slice("file:./".length))}`;
  }

  return value;
}

const databaseUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
