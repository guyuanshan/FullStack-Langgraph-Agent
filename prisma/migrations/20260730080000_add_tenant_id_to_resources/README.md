# add_tenant_id_to_resources

Adds required `tenantId` (and `Tenant.isActive`) to core business tables.

## Forward

```bash
pnpm exec prisma migrate deploy
pnpm db:generate
pnpm db:setup   # also creates default-tenant owner via AUTH_BOOTSTRAP_* if missing
VERIFY_REQUIRE_DEFAULT_ADMIN=1 pnpm db:verify-tenant
```

Existing rows are backfilled to `default-tenant`. Child rows inherit tenant from their Session/AgentRun when available.

Admin users are **not** created by SQL alone (password hashing is owned by Better Auth). Use `pnpm db:setup` / `pnpm auth:bootstrap`.

## Rollback

SQLite does not support transactional DDL rollback across redefine steps. Recovery options:

1. Restore from a pre-migration database backup (`prisma/dev.db` copy).
2. Run `pnpm db:tenant-drill` on a disposable copy to rehearse backup/verify/cross-tenant rejection.
3. Or recreate the previous schema from `prisma/migrations` history on a fresh database and restore application data from backup.

Do not attempt partial reverse SQL against a partially migrated file. See also `../20260730090000_enforce_tenant_composite_fks/rollback.md`.
