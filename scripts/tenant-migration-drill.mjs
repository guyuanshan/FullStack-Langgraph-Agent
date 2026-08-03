import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dbPath = path.join(root, "prisma", "dev.db");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(root, ".demo-output", "tenant-migration-drills");
const backupPath = path.join(outDir, `dev.db.pre-drill-${stamp}`);
const reportPath = path.join(outDir, `drill-${stamp}.json`);

mkdirSync(outDir, { recursive: true });
copyFileSync(dbPath, backupPath);

const verify = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--env-file-if-exists=.env.local",
    "scripts/verify-tenant-backfill.mjs",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_REQUIRE_DEFAULT_ADMIN: "1",
    },
  }
);

const crossTenantProbe = spawnSync(
  "sqlite3",
  [
    dbPath,
    `PRAGMA foreign_keys=ON;
     INSERT INTO "Tenant" ("id","name","isActive","createdAt","updatedAt")
     SELECT 'other-tenant','Other',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
     WHERE NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id"='other-tenant');
     SELECT id FROM "Session" LIMIT 1;`,
  ],
  { encoding: "utf8" }
);

const sessionId = crossTenantProbe.stdout.trim().split("\n").pop();
let crossTenantInsertRejected = false;
let crossTenantError = null;

if (sessionId) {
  const insert = spawnSync(
    "sqlite3",
    [
      dbPath,
      `PRAGMA foreign_keys=ON;
       INSERT INTO "Message" (
         "id","tenantId","sessionId","orderIndex","role","content","rawJson","archived","createdAt"
       ) VALUES (
         'drill-cross-tenant-msg','other-tenant','${sessionId}',999999,'user','x','{}',0,CURRENT_TIMESTAMP
       );`,
    ],
    { encoding: "utf8" }
  );
  crossTenantInsertRejected = insert.status !== 0;
  crossTenantError = insert.stderr.trim() || insert.stdout.trim() || null;
  spawnSync("sqlite3", [
    dbPath,
    `PRAGMA foreign_keys=ON;
     DELETE FROM "Message" WHERE "id"='drill-cross-tenant-msg';`,
  ]);
}

const report = {
  timestamp: new Date().toISOString(),
  backupPath,
  verifyExitCode: verify.status,
  verifyStdout: verify.stdout,
  verifyStderr: verify.stderr,
  crossTenantProbe: {
    sessionId: sessionId || null,
    insertRejected: crossTenantInsertRejected,
    error: crossTenantError,
  },
  rollbackPlan:
    "Restore prisma/dev.db from the backupPath above if a drill/migration misbehaves.",
  passed:
    verify.status === 0 &&
    Boolean(sessionId) &&
    crossTenantInsertRejected === true,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  process.exit(1);
}
