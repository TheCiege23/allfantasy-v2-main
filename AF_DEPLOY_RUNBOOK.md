# AllFantasy — Deploy runbook (staging → prod, migration-first)

Ships the `feat/af-phase2-dashboard` branch — which contains Phase 0 (rank/import fixes), the
`franchise_seasons` migration, and all of Phase 2 (the `/dashboard/universal` route). Run in Claude
Code with git + shell access.

**The one hard rule:** the `franchise_seasons` migration MUST apply to a database *before* the code
that writes to it serves there. That write lives in `enterRedraftOffseason`'s transaction with no
try/catch — if the code runs before the table exists, ending a season throws and rolls back. So
migrate first, every environment.

---

## 0. Confirm deploy targets (do this before anything)
Report to the user, don't assume:
- Which platform serves prod — inspect `vercel.json`, `railway.json`, `nixpacks.toml`, and
  `git remote -v`. Note the prod build command (Vercel `build:vercel` = `db:migrate:deploy &&
  vercel-build`, so it migrates first — confirm that's the prod command; check Railway's build/start).
- Which **branch** each platform deploys prod from (main? a release branch?). This tree has
  historically been far ahead of `main`, so the merge target is a real decision — surface it.

## 1. Pre-flight (on the branch)
- `npm run typecheck` (expect only the ~191 pre-existing baseline errors), `npm run build`
  (`✓ Compiled` — the local Windows `readlink EISDIR` after compile is a known non-failure), and the
  rank + import test suites green. All already verified this session.
- Confirm the branch actually contains the migration: `git log --oneline | grep franchise_seasons`
  (commit `1a4eead9a`).

## 2. Staging
1. Point at the staging DB (`.env.staging`); `npm run check:staging-env`.
2. **Migrate first:** `npm run db:migrate:deploy` against the staging DATABASE_URL. Confirm
   `franchise_seasons` now exists on staging (`information_schema` check).
3. Deploy the branch to staging (`npm run staging:deploy`, or a Vercel preview of the branch).
4. Validate: `npm run staging:validate`; then click through `/dashboard/universal` in light AND dark;
   run one redraft **season-finalize** end-to-end (proves the `franchise_seasons` write path doesn't
   throw); spot-check rank compute and one import.
5. Only proceed to prod once staging looks right.

## 3. Production (after staging passes)
1. Merge `feat/af-phase2-dashboard` → the prod-deployable branch (per step 0). Keep the diff scoped;
   PR + review is safest given branch history.
2. **Guarantee migrate-first in prod:** confirm the prod pipeline runs `prisma migrate deploy` before
   serving. If there's any doubt, run `prisma migrate deploy` against the prod DATABASE_URL manually
   FIRST, then trigger the code deploy. (Do not let new code serve before the table exists.)
3. Deploy. Verify prod: `/dashboard/universal` loads; end a test season to confirm the write path is
   safe; rank computes.

## 4. Rollback
- The migration is purely additive (`CREATE TABLE` + indexes/FK) — safe to leave even on revert.
- `/dashboard/universal` is a new route (Phase 2 built alongside), so reverting the merge doesn't
  touch the existing dashboard.
- If a rank/import regression appears, revert the specific Phase 0 commits; the migration can stay.

## Notes
- Backfill (`scripts/backfill-franchise-seasons.ts`) is NOT part of this deploy — it has nothing to
  do in prod yet (no native league has finalized a season). Run it later, with approval, once they do.
- The script hard-refuses the prod host (`ep-curly-block`) — that guard stays.
