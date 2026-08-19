-- Prompt 2 Commit 1 — the dashboard league board needs to distinguish leagues the
-- guest/user commissions from ones they merely play in. Sleeper's league-users
-- endpoint marks the commissioner with `is_owner: true`; captured at import time
-- in `lib/legacy-import.ts` and persisted here.
--
-- Purely additive, defaulted false so existing rows remain valid without a backfill.
ALTER TABLE "LegacyLeague" ADD COLUMN "isCommissioner" BOOLEAN NOT NULL DEFAULT false;
