# `migrations-pending/` — written, reviewed by nobody, NOT in the deploy path

A migration in `prisma/migrations/` is **live**, whether or not it is committed:
`prisma migrate deploy` reads the **directory**, not git. Anyone running it from
this shared checkout applies every pending migration they find, regardless of
which one they meant to apply.

That is not hypothetical. On 2026-08-31 the commit/review session had already
handed its user `ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod` to apply
*someone else's* Fantrax column, and had to retract it because an unrelated
324-line migration touching `leagues` was sitting in the same directory.

So: a migration lands here first, and moves to `prisma/migrations/` only when
its author's user has explicitly authorised applying it. Moving it is the
deliberate act; writing it is not.

## Why this is not just "commit it and be careful"

Committing makes a migration reviewable, which is good and should also happen.
It does **not** remove it from the deploy path — a committed migration in
`prisma/migrations/` is swept up by exactly the same command. Review and
reachability are different problems, and only this directory fixes the second.

## The cost of leaving one in the real directory

A migration that fails — including one that fails **correctly**, on a guard —
writes a `finished_at IS NULL` row into `_prisma_migrations`, and every later
`migrate deploy` then aborts with **P3009** until someone resolves it by hand.
A well-guarded refusal still blocks everyone. Parking it here means the guard
never has to fire.

## Currently parked

### `20260831120000_commissioner_os_t101`

Commissioner OS T-101 — tenancy tables, `League.tenantId` three-step backfill,
partial uniques, GIN index. See `docs/commissioner-os/SCOPE.md`.

**Blocked on T-001.** Its own guard raises unless the four `commish_*` roles
exist, and as of 2026-08-31 none of them do — measured, not assumed:
`npm run test:commissioner-os` reports six of eight assertions failing, every
one because the roles are absent.

To apply it, in order:

```
1. psql "$DIRECT_URL" … -f prisma/roles/001_provision_roles.sql
2. npm run test:commissioner-os          # must be green first
3. git mv prisma/migrations-pending/20260831120000_commissioner_os_t101 prisma/migrations/
4. npx prisma migrate deploy             # against a Neon branch, not production
```

⚠ Step 3 is the point of no return for everyone sharing this checkout, not just
for you. Do it as close to step 4 as possible.
