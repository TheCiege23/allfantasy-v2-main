# Commissioner OS — local setup

The four-role split from `TENANCY.md` §3.1, on a fresh clone. This is the part
the handoff warns "trips people on a fresh clone", and it trips them in a
specific way: everything appears to work with one role, right up until the
isolation tests pass against a control that is not running.

## Order

T-001 before T-101, and it is enforced rather than asked for — the T-101
migration raises if the roles are absent.

```
1. provision the roles      prisma/roles/001_provision_roles.sql
2. verify them              npm run test:commissioner-os
3. (decide) move ownership  prisma/roles/002_transfer_ownership.sql
4. then, and only then      npx prisma migrate deploy
```

## 1 · Provision

Run as a role that can create roles. On Neon that is the project owner,
`neondb_owner`.

```bash
psql "$DIRECT_URL" \
  -v app_password="$(openssl rand -base64 24)" \
  -v platform_password="$(openssl rand -base64 24)" \
  -v purge_password="$(openssl rand -base64 24)" \
  -v migrate_password="$(openssl rand -base64 24)" \
  -f prisma/roles/001_provision_roles.sql
```

The passwords are psql variables, so none of them lands in a file. **Capture
them as you go** — they are not recoverable, and this repo is public.

> 🛑 **Do not create these roles in the Neon console.** Console-created roles
> are added to `neon_superuser`. `commish_app` must be a member of nothing, or
> it can `SET ROLE` into a role that bypasses RLS — and every isolation test
> still passes while it can. The SQL script creates plain roles; step 2 is what
> proves it.

## 2 · Verify

```bash
npm run test:commissioner-os
```

Seven assertions, and the two worth knowing about:

- **`commish_app` is a member of no other role.** The `SET ROLE` escape hatch.
  This is the one most likely to fail on Neon, and it fails silently in every
  other respect.
- **`commish_app` owns no tables.** A table owner bypasses RLS unless the table
  is `FORCE`d.

The suite deliberately **fails rather than skips** when it cannot reach the
database. The only skip is "no connection string configured at all", and it
says so. A green run that never connected is precisely the failure this whole
architecture is built to avoid.

It is not in `npm test` — it needs a live provisioned database, and a
permanently-red suite is one nobody reads. That is also why the files are
`.spec.ts`: the default vitest config only collects `*.test.ts`.

## 3 · Ownership — a decision, not a step

`prisma/roles/002_transfer_ownership.sql` makes `commish_migrate` the owner of
the existing schema. On this database that is **710 tables**, and
`REASSIGN OWNED` takes an `ACCESS EXCLUSIVE` lock on each one. It is a
maintenance window.

The destructive statements in that file are **commented out on purpose**, so
running it by accident prints the current owner and stops. Read its header
before uncommenting.

> ⚠ Take a Neon branch first. And note that a `.vercel.app` preview URL is
> **not** proof you are off the production database — this project's previews
> use it. `npx tsx scripts/check-staging-env.ts` is what settles which database
> you are on; the hostname is not.

## 4 · Connection URLs

Three, not two — see the block added to `.env.example`.

| Env | Role | Pooling | Used by |
|---|---|---|---|
| `DATABASE_URL` → `commish_app` | app | pooled, `?pgbouncer=true` | every request path |
| `DIRECT_URL` → `commish_migrate` | owner | **direct** | `prisma migrate` only |
| `COMMISH_PLATFORM_URL` → `commish_platform` | cross-tenant read | separate pool | T-105 platform support |

`commish_purge` gets no app env var at all. It belongs to the purge job's
environment; if the web process can read it, invariant 4 ("no application code
issues `DELETE`") is one import away from being false.

> 🛑 **THE REAL `COMMISH_*` URLS GO IN `.env.local`. NEVER IN `.env.example`.**
>
> `.env.example` is **tracked**, and this repo is **public**. `.gitignore` does
> not protect a file that is already tracked — `.env*` is ignored, which is why
> an untracked `.env` cannot be committed by accident, but the ignore rule is
> silent about `.env.example`, `.env.local.example` and `.env.production`
> forever. Pasting a real value into one and committing publishes it.
>
> The entries this ticket added to `.env.example` are commented out and carry no
> values, which is correct and must stay that way. The one to be careful with is
> `COMMISH_MIGRATE_URL`: that role **owns every table**, so publishing it is not
> "a database credential leaked", it is schema-level access to production. And a
> published credential is not undone by a later commit — you rotate it, you do
> not un-publish it.
>
> `scripts/secret-scan.mjs` now runs from the pre-push hook and checks every
> tracked `.env*` file, so this is guarded rather than merely documented. It
> fails **closed** — unlike the build and queue guards, which fail open, because
> a false stop here costs a delayed push and a false pass costs a live
> credential in a public repo. Run `npm run hooks:install` on a fresh clone;
> the hook lives in the git common dir and is not version-controlled.

**Why direct for migrations:** `prisma migrate` takes advisory locks and runs
DDL, and neither survives a transaction-mode pooler. **Why pooled for the app:**
Prisma's named prepared statements break under pgbouncer transaction mode
without `?pgbouncer=true`.

## Current state

`COMMISH_PLATFORM_URL` is documented and **not read by anything yet** — the
platform pool arrives with T-105. `lib/domain/db.ts` and `withTenant` (T-002)
do not exist. Nothing in the running app connects as `commish_app` today.

So provisioning the roles changes nothing about how AllFantasy behaves right
now. That is the intended state after T-001: the boundary exists, and nothing
has been moved behind it yet.
