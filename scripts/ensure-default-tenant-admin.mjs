import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "../src/generated/prisma/index.js";

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

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolveDatabaseUrl(),
    },
  },
});

try {
  const tenant = await prisma.tenant.findUnique({
    where: { id: "default-tenant" },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error(
      "default-tenant is missing. Apply Prisma migrations before bootstrapping admin."
    );
  }

  const owner = await prisma.tenantMember.findFirst({
    where: {
      tenantId: "default-tenant",
      role: "owner",
    },
    select: { id: true },
  });

  if (owner) {
    console.log("Default tenant already has an owner membership.");
    process.exit(0);
  }

  if (
    !process.env.AUTH_BOOTSTRAP_EMAIL?.trim() ||
    !process.env.AUTH_BOOTSTRAP_PASSWORD?.trim()
  ) {
    throw new Error(
      "Default tenant has no owner. Set AUTH_BOOTSTRAP_EMAIL and AUTH_BOOTSTRAP_PASSWORD, then rerun."
    );
  }

  const result = spawnSync(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "--env-file-if-exists=.env.local",
      "scripts/bootstrap-auth.mjs",
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    }
  );

  process.exit(result.status ?? 1);
} finally {
  await prisma.$disconnect();
}
