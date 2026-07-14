-- Real, previously-undetected migration gap found via physical database
-- testing (this phase, against a disposable Neon branch built entirely from
-- the checked-in migration chain): prisma/schema.prisma's LeagueLifecycleState
-- enum declares 'offseason' and 'renewal_pending' (added in
-- 20260419290000_league_lifecycle_audit's schema-level declaration history,
-- and consumed by real, already-shipped code — openRedraftRenewal's
-- `league.lifecycleState !== 'offseason'` guard, transitionLeagueState's
-- 'renewal_pending' target state) but no migration file anywhere in this
-- directory ever ran `ALTER TYPE ... ADD VALUE` for either. `prisma migrate
-- status`/`migrate deploy` reported "up to date" because they only track
-- which migration FILES have been applied, not whether the deployed enum
-- DDL actually matches the current schema.prisma declaration — this drift
-- is invisible to those commands and was only found by physically exercising
-- code that uses the missing values against a real, migration-built database.
-- Purely additive: no value is removed, no table/column/type is dropped.
ALTER TYPE "LeagueLifecycleState" ADD VALUE IF NOT EXISTS 'offseason';
ALTER TYPE "LeagueLifecycleState" ADD VALUE IF NOT EXISTS 'renewal_pending';
