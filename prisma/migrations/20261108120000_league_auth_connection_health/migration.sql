-- ESPN connection health on "league_auths". WRITTEN, NOT APPLIED — see
-- prisma/migrations-pending/README.md. Owner approved the change on 2026-11-08; APPLYING it is a
-- separate decision that belongs to the owner.
--
-- 🛑 THE CODE THAT READS THESE COLUMNS MUST NOT SHIP BEFORE THIS IS APPLIED. `schema.prisma` gains
-- the fields in the same commit, so the generated client SELECTs them on every un-`select`ed
-- `leagueAuth` read (`getDecryptedAuth` is one). Against a database without them that is P2022 on
-- every provider credential read — MFL, Yahoo and Fantrax included, not only ESPN. Order:
--   1. apply this migration;   2. then land the commit that carries it.
--
-- ── WHAT IT IS FOR ──────────────────────────────────────────────────────────────────────────
-- ESPN cookies expire (signing out of ESPN in that browser ends them). Until now nothing recorded
-- that: an import said "reconnect" at the moment it failed, but the background sync logged a failed
-- run and the user was never told. These columns let the read path mark the connection as needing
-- reconnection, let the UI say so, and let us notify the user ONCE rather than on every sync tick.
--
-- Additive and nullable: no default, no backfill, no lock beyond a catalog update on Postgres 11+.
-- NULL "connectionStatus" means "never checked since this column existed" and reads as healthy.

ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS "connectionStatus" TEXT;
ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3);
ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS "lastFailureAt" TIMESTAMP(3);
ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS "lastFailureCode" TEXT;
ALTER TABLE "league_auths" ADD COLUMN IF NOT EXISTS "reconnectNotifiedAt" TIMESTAMP(3);
