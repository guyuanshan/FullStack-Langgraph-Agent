# Rollback checklist (pre-production drill)

SQLite table-redefine migrations cannot be cleanly reversed with generated down SQL. Treat rollback as backup restore.

## Pre-flight

- [ ] Copy `prisma/dev.db` to a dated backup path
- [ ] Record current migration revision (`prisma migrate status`)
- [ ] Confirm `AUTH_BOOTSTRAP_*` env is available for re-seed if needed

## Drill

```bash
node scripts/tenant-migration-drill.mjs
```

Expected:

- [ ] verify exits 0
- [ ] report marks `crossTenantProbe.insertRejected = true`
- [ ] backup file written under `.demo-output/tenant-migration-drills/`

## Rollback procedure

1. Stop the app / any writers
2. Replace `prisma/dev.db` with the pre-migration or pre-drill backup
3. Run `pnpm db:generate`
4. Run `VERIFY_REQUIRE_DEFAULT_ADMIN=1 pnpm db:verify-tenant`
5. Record restore path, operator, and timestamp in the drill report notes

## Notes

- Do not hand-edit partially migrated SQLite files
- If only application code rolled back, keep this migration applied; schema constraints are forward-compatible with the hardened writers
