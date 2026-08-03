import path from "node:path";
import process from "node:process";
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

const requireAdmin =
  process.env.VERIFY_REQUIRE_DEFAULT_ADMIN === "1" ||
  process.env.VERIFY_REQUIRE_DEFAULT_ADMIN === "true";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolveDatabaseUrl(),
    },
  },
});

const nullTenantChecks = [
  "Session",
  "Message",
  "ProjectMemory",
  "AuditLog",
  "AgentRun",
  "AgentStep",
  "InterruptEvent",
  "ErrorLog",
  "ModelCall",
  "ToolCall",
  "Checkpoint",
  "AgentTrace",
].map((table) => [
  `${table}.tenantId not null`,
  `SELECT COUNT(*) AS c FROM "${table}" WHERE "tenantId" IS NULL OR "tenantId" = ''`,
]);

const relationChecks = [
  [
    "Message↔Session",
    `SELECT COUNT(*) AS c FROM "Message" m
     LEFT JOIN "Session" s ON s."id" = m."sessionId"
     WHERE s."id" IS NULL OR m."tenantId" != s."tenantId"`,
  ],
  [
    "Checkpoint↔Session",
    `SELECT COUNT(*) AS c FROM "Checkpoint" c
     LEFT JOIN "Session" s ON s."id" = c."sessionId"
     WHERE s."id" IS NULL OR c."tenantId" != s."tenantId"`,
  ],
  [
    "AgentTrace↔Session",
    `SELECT COUNT(*) AS c FROM "AgentTrace" t
     LEFT JOIN "Session" s ON s."id" = t."sessionId"
     WHERE s."id" IS NULL OR t."tenantId" != s."tenantId"`,
  ],
  [
    "ToolCall↔Session",
    `SELECT COUNT(*) AS c FROM "ToolCall" t
     LEFT JOIN "Session" s ON s."id" = t."sessionId"
     WHERE s."id" IS NULL OR t."tenantId" != s."tenantId"`,
  ],
  [
    "AgentRun↔Session",
    `SELECT COUNT(*) AS c FROM "AgentRun" r
     LEFT JOIN "Session" s ON s."id" = r."sessionId"
     WHERE r."sessionId" IS NOT NULL AND (s."id" IS NULL OR r."tenantId" != s."tenantId")`,
  ],
  [
    "AgentStep↔Session",
    `SELECT COUNT(*) AS c FROM "AgentStep" st
     LEFT JOIN "Session" s ON s."id" = st."sessionId"
     WHERE st."sessionId" IS NOT NULL AND (s."id" IS NULL OR st."tenantId" != s."tenantId")`,
  ],
  [
    "AgentStep↔AgentRun",
    `SELECT COUNT(*) AS c FROM "AgentStep" st
     LEFT JOIN "AgentRun" r ON r."id" = st."runId"
     WHERE r."id" IS NULL OR st."tenantId" != r."tenantId"`,
  ],
  [
    "ToolCall↔AgentRun",
    `SELECT COUNT(*) AS c FROM "ToolCall" t
     LEFT JOIN "AgentRun" r ON r."id" = t."runId"
     WHERE t."runId" IS NOT NULL AND (r."id" IS NULL OR t."tenantId" != r."tenantId")`,
  ],
  [
    "ToolCall↔AgentStep",
    `SELECT COUNT(*) AS c FROM "ToolCall" t
     LEFT JOIN "AgentStep" st ON st."id" = t."stepId"
     WHERE t."stepId" IS NOT NULL AND (st."id" IS NULL OR t."tenantId" != st."tenantId")`,
  ],
  [
    "AuditLog↔Session",
    `SELECT COUNT(*) AS c FROM "AuditLog" a
     LEFT JOIN "Session" s ON s."id" = a."sessionId"
     WHERE a."sessionId" IS NOT NULL AND (s."id" IS NULL OR a."tenantId" != s."tenantId")`,
  ],
  [
    "AuditLog↔ToolCall",
    `SELECT COUNT(*) AS c FROM "AuditLog" a
     LEFT JOIN "ToolCall" t ON t."id" = a."toolCallId"
     WHERE a."toolCallId" IS NOT NULL AND (t."id" IS NULL OR a."tenantId" != t."tenantId")`,
  ],
  [
    "InterruptEvent↔AgentRun",
    `SELECT COUNT(*) AS c FROM "InterruptEvent" i
     LEFT JOIN "AgentRun" r ON r."id" = i."runId"
     WHERE r."id" IS NULL OR i."tenantId" != r."tenantId"`,
  ],
  [
    "InterruptEvent↔Session",
    `SELECT COUNT(*) AS c FROM "InterruptEvent" i
     LEFT JOIN "Session" s ON s."id" = i."sessionId"
     WHERE i."sessionId" IS NOT NULL AND (s."id" IS NULL OR i."tenantId" != s."tenantId")`,
  ],
  [
    "InterruptEvent↔AgentStep",
    `SELECT COUNT(*) AS c FROM "InterruptEvent" i
     LEFT JOIN "AgentStep" st ON st."id" = i."stepId"
     WHERE i."stepId" IS NOT NULL AND (st."id" IS NULL OR i."tenantId" != st."tenantId")`,
  ],
  [
    "ErrorLog↔Session",
    `SELECT COUNT(*) AS c FROM "ErrorLog" e
     LEFT JOIN "Session" s ON s."id" = e."sessionId"
     WHERE e."sessionId" IS NOT NULL AND (s."id" IS NULL OR e."tenantId" != s."tenantId")`,
  ],
  [
    "ErrorLog↔AgentRun",
    `SELECT COUNT(*) AS c FROM "ErrorLog" e
     LEFT JOIN "AgentRun" r ON r."id" = e."runId"
     WHERE e."runId" IS NOT NULL AND (r."id" IS NULL OR e."tenantId" != r."tenantId")`,
  ],
  [
    "ErrorLog↔AgentStep",
    `SELECT COUNT(*) AS c FROM "ErrorLog" e
     LEFT JOIN "AgentStep" st ON st."id" = e."stepId"
     WHERE e."stepId" IS NOT NULL AND (st."id" IS NULL OR e."tenantId" != st."tenantId")`,
  ],
  [
    "ModelCall↔AgentRun",
    `SELECT COUNT(*) AS c FROM "ModelCall" m
     LEFT JOIN "AgentRun" r ON r."id" = m."runId"
     WHERE r."id" IS NULL OR m."tenantId" != r."tenantId"`,
  ],
  [
    "ModelCall↔Session",
    `SELECT COUNT(*) AS c FROM "ModelCall" m
     LEFT JOIN "Session" s ON s."id" = m."sessionId"
     WHERE m."sessionId" IS NOT NULL AND (s."id" IS NULL OR m."tenantId" != s."tenantId")`,
  ],
  [
    "ModelCall↔AgentStep",
    `SELECT COUNT(*) AS c FROM "ModelCall" m
     LEFT JOIN "AgentStep" st ON st."id" = m."stepId"
     WHERE m."stepId" IS NOT NULL AND (st."id" IS NULL OR m."tenantId" != st."tenantId")`,
  ],
  [
    "ProjectMemory orphan tenant",
    `SELECT COUNT(*) AS c FROM "ProjectMemory" p
     LEFT JOIN "Tenant" t ON t."id" = p."tenantId"
     WHERE t."id" IS NULL`,
  ],
];

async function assertZero(name, sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  const count = Number(rows[0]?.c ?? 0);

  if (count > 0) {
    throw new Error(`${name} failed: ${count}`);
  }

  console.log(`OK ${name}`);
}

try {
  const tenants = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS c FROM "Tenant" WHERE "id" = \'default-tenant\''
  );

  if (Number(tenants[0]?.c ?? 0) < 1) {
    throw new Error("default-tenant is missing");
  }

  console.log("OK default-tenant exists");

  const owners = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM "TenantMember"
     WHERE "tenantId" = 'default-tenant' AND "role" = 'owner'`
  );
  const ownerCount = Number(owners[0]?.c ?? 0);

  if (requireAdmin && ownerCount < 1) {
    throw new Error(
      "default-tenant has no owner membership. Run pnpm auth:bootstrap / pnpm db:setup."
    );
  }

  if (ownerCount < 1) {
    console.warn(
      "WARN default-tenant has no owner membership (run pnpm db:setup)."
    );
  } else {
    console.log("OK default-tenant owner membership");
  }

  for (const [name, sql] of [...nullTenantChecks, ...relationChecks]) {
    await assertZero(name, sql);
  }

  const fkViolations = await prisma.$queryRawUnsafe(
    "PRAGMA foreign_key_check"
  );

  if (Array.isArray(fkViolations) && fkViolations.length > 0) {
    throw new Error(
      `PRAGMA foreign_key_check reported ${fkViolations.length} violation(s)`
    );
  }

  console.log("OK PRAGMA foreign_key_check");
  console.log("Tenant consistency verification passed.");
} finally {
  await prisma.$disconnect();
}
