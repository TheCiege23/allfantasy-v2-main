-- Add the second foreign key on `Player.id`, covering
-- `sports_core_player_provider_identities`.
--
-- WHY THIS IS SEPARATE FROM THE IMAGE FK
-- `20260817120000_player_image_player_fk` fixed the column that had actually broken (215 of
-- 443 image rows orphaned). This one had ZERO orphans across 96,957 rows, so it is prevention
-- rather than repair, and the ON DELETE choice needed deciding on its own evidence.
--
-- WHY CASCADE AND NOT RESTRICT
-- An orphaned identity row is worse than useless. This table carries
-- `uniq_player_provider_identity` on (provider, sport_key, league_key, provider_player_id) —
-- plus a partial index `uniq_ppi_provider_sport_pid_null_league` that enforces the same key for
-- the NULL-league_key rows Postgres would otherwise treat as always-distinct. `player_id` is
-- NOT part of either key, so a row left pointing at a deleted player still OCCUPIES the slot
-- and blocks re-linking that provider id to the correct player. Verified directly against
-- production: the re-link insert fails with 23505 on `uniq_ppi_provider_sport_pid_null_league`.
-- CASCADE removes such rows; RESTRICT would instead start throwing on player deletes that
-- succeed today.
-- Identity rows are also re-derivable from providers, so cascading loses nothing permanent,
-- and the dedupe flow repoints them before deleting a player, so this never fires there.
--
-- These two columns are the ONLY columns in the database holding `Player.id`. The three
-- sibling `player_id` columns (season_stats, news_items, injury_reports) are deliberately NOT
-- constrained: they are all empty, nothing writes season_stats at all, and the only writer of
-- the other two (`scripts/seed-redraft-war-room-runtime.ts`) inserts synthetic ids like
-- `rwr-member-wr-3` that are not in the `Player.id` namespace. Constraining them would encode
-- a namespace decision nobody has made yet.
--
-- PRODUCTION NOTE
-- Apply with `node scripts/apply-player-identity-fk.cjs --apply`. Do NOT use
-- `prisma migrate deploy` (hand-repaired history) and do NOT use `psql "$DIRECT_URL"` on
-- Windows (`$VAR` expands to empty in PowerShell and silently targets localhost).

-- Defensive: no orphans exist as of writing, but a migration must be able to run on any
-- environment, and the constraint below cannot validate while any remain.
DELETE FROM "sports_core_player_provider_identities" i
WHERE i."player_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."id" = i."player_id");

ALTER TABLE "sports_core_player_provider_identities"
  ADD CONSTRAINT "sports_core_player_provider_identities_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "Player"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- `@@index([playerId])` already exists on this table, so unlike the image table there is no
-- index to add here: the FK's referencing side is already covered.
