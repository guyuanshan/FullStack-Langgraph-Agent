# enforce_tenant_composite_fks

## What changed

- Required child→parent links use composite FKs `(tenantId, parentId)`.
- Optional parent links keep `ON DELETE SET NULL` single-column FKs and gain SQLite triggers that abort cross-tenant writes.
- `Session(tenantId, id)` and `AgentRun(tenantId, id)` are unique.

## Apply

```bash
pnpm exec prisma migrate deploy
pnpm db:generate
VERIFY_REQUIRE_DEFAULT_ADMIN=1 pnpm db:verify-tenant
pnpm db:setup   # migrate + ensure default tenant owner via bootstrap env
```

## Empty-database admin

SQL migrations only ensure `default-tenant`. Creating the first owner requires password hashing through Better Auth, so admin creation is handled by:

```bash
pnpm auth:bootstrap
# or
pnpm db:setup
```

`db:setup` fails if `AUTH_BOOTSTRAP_EMAIL` / `AUTH_BOOTSTRAP_PASSWORD` are missing when no owner exists.

## Rollback / drill

SQLite redefine migrations are not safely reversible in place.

1. Before migrate: copy `prisma/dev.db`.
2. Run `node scripts/tenant-migration-drill.mjs` to:
   - snapshot DB under `.demo-output/tenant-migration-drills/`
   - run full verify
   - prove cross-tenant `Message` insert is rejected
3. On failure: restore the snapshot over `prisma/dev.db`.

See `rollback.md` in this folder for the checklist.
