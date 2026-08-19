-- Add the first-ever foreign key on `Player.id`, covering `sports_core_player_images`.
--
-- WHY
-- There are zero FK constraints on `Player.id` in this schema. That is why 215 of the 443
-- rows in `sports_core_player_images` could hold a well-formed `Player.id` that matches no
-- player: nothing was ever positioned to reject them. The rows were not written by a broken
-- ingest ordering — `resolvePlayerHeadshot` DERIVES a canonical id when its caller has none,
-- and `deriveCanonicalPlayerIdentity` changes its entire match key depending on whether a
-- sleeperId is present, so the id a live request derives routinely differs from the one the
-- canonical backfill stored for the same person. The application-side guard now lives in
-- `writePrimaryPlayerImage`; this constraint is the backstop that makes the guard
-- unbypassable by any future writer.
--
-- ORDER MATTERS
-- The orphan rows must be gone before the constraint can validate. They are deleted here
-- rather than in a separate script so a fresh environment cannot end up with the constraint
-- missing because someone skipped a manual step. The delete is safe: these rows are a
-- derived headshot cache keyed by an id nothing can look up, so nothing reads them — the
-- only effect is one re-resolution per affected player.
--
-- PRODUCTION NOTE
-- Apply this SQL directly. Do NOT run `prisma migrate deploy` against production in this
-- repo; migration history has been repaired by hand before and `migrate deploy` will try to
-- replay it.

-- 1. Remove rows whose player_id names no canonical player.
DELETE FROM "sports_core_player_images" i
WHERE i."player_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."id" = i."player_id");

-- 2. Constrain the column. NULL player_id stays legal: the column is nullable by design and
--    Postgres does not enforce FKs on NULLs.
ALTER TABLE "sports_core_player_images"
  ADD CONSTRAINT "sports_core_player_images_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "Player"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Index the FK column. Postgres does not create one automatically for the referencing
--    side, and without it every `Player` delete degrades to a sequential scan of this table.
CREATE INDEX IF NOT EXISTS "sports_core_player_images_player_id_idx"
  ON "sports_core_player_images"("player_id");

-- NOT DONE HERE, DELIBERATELY
-- `sports_core_player_provider_identities.player_id` is the only other column in the database
-- holding `Player.id` (96,957 rows, currently ZERO orphans), so it could take the same
-- constraint today for free. It is left out because the right ON DELETE behaviour is a
-- different judgement call: identities are identity data, not a cache, so CASCADE would let a
-- merge that forgot to repoint them destroy them silently, while RESTRICT would start
-- throwing on `Player` deletes that succeed today. Decide that on its own terms.
