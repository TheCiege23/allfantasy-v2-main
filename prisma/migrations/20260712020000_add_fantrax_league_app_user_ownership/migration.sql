-- Import Security Closure phase — real finding: FantraxUser (the model that owns
-- uploaded league snapshots) has no relationship to AppUser at all. The CSV
-- upload endpoint's `username` field is entirely client-supplied and was never
-- cross-checked against the authenticated caller's own identity, so an
-- authenticated user could upload/read data under any Fantrax username they
-- chose to type in.
--
-- Purely additive: no value is removed, no table/column/type is dropped.
-- Nullable so pre-existing rows (if any) remain valid — reads/commits fail
-- closed (reject, not fabricate ownership) for any row where this is null,
-- enforced in application code (fetchFantraxLeagueForImport /
-- server/api-route-modules/legacy/fantrax/route.ts), not by a NOT NULL
-- constraint, since a hard backfill of historical rows to a real owner is not
-- safely inferable from existing data.
ALTER TABLE "FantraxLeague" ADD COLUMN "appUserId" TEXT;

CREATE INDEX "FantraxLeague_appUserId_idx" ON "FantraxLeague"("appUserId");

ALTER TABLE "FantraxLeague" ADD CONSTRAINT "FantraxLeague_appUserId_fkey"
  FOREIGN KEY ("appUserId") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
