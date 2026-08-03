import path from "node:path";
import process from "node:process";
import { hashPassword } from "better-auth/crypto";
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

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

const email = requireEnvironmentValue("AUTH_BOOTSTRAP_EMAIL").toLowerCase();
const name = process.env.AUTH_BOOTSTRAP_NAME?.trim() || "Administrator";
const password = requireEnvironmentValue("AUTH_BOOTSTRAP_PASSWORD");
const tenantId =
  process.env.AUTH_BOOTSTRAP_TENANT_ID?.trim() || "default-tenant";
const tenantName =
  process.env.AUTH_BOOTSTRAP_TENANT_NAME?.trim() || "Default Tenant";

if (password.length < 12 || password.length > 128) {
  throw new Error(
    "AUTH_BOOTSTRAP_PASSWORD must contain between 12 and 128 characters."
  );
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolveDatabaseUrl(),
    },
  },
});

try {
  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: {
        email,
      },
      update: {
        name,
        emailVerified: true,
      },
      create: {
        id: crypto.randomUUID(),
        email,
        emailVerified: true,
        name,
      },
    });

    await transaction.authSession.deleteMany({
      where: {
        userId: user.id,
      },
    });

    await transaction.authAccount.upsert({
      where: {
        providerId_accountId: {
          providerId: "credential",
          accountId: user.id,
        },
      },
      update: {
        password: passwordHash,
      },
      create: {
        id: crypto.randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      },
    });

    const tenant = await transaction.tenant.upsert({
      where: {
        id: tenantId,
      },
      update: {
        name: tenantName,
      },
      create: {
        id: tenantId,
        name: tenantName,
      },
    });

    await transaction.tenantMember.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: {
        role: "owner",
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: "owner",
      },
    });

    return {
      email: user.email,
      tenantId: tenant.id,
      tenantName: tenant.name,
    };
  });

  console.log(
    `Bootstrap account ready: ${result.email} (${result.tenantName}, ${result.tenantId}).`
  );
  console.log("All previous sessions for this account were revoked.");
} finally {
  await prisma.$disconnect();
}
