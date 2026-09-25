-- PlayerNewsRecord.updated_at — the one thing the retry ledger cannot do without a column.
--
-- 🛑 PARKED IN `migrations-pending/` ON PURPOSE, AND NOT APPLIED. `prisma migrate deploy` reads
-- the DIRECTORY, not git, so anything sitting in `prisma/migrations/` is applied by whoever
-- next runs it from this shared checkout, regardless of which migration they meant. See the
-- README beside this file. It moves only when the owner has explicitly authorised applying it.
--
-- ── WHY IT IS NEEDED ────────────────────────────────────────────────────────────────────────
--
-- `lib/notifications/PlayerNewsNotificationService.ts` selects candidate rows with
-- `WHERE notification_dispatched_at IS NULL`. Once a row is stamped it leaves the candidate set
-- permanently. That is correct for a story that was DELIVERED — repeating it is a duplicate —
-- but wrong for one whose CONTENT later changes, which the blueprint's early-report policy
-- makes an ordinary event: a report is published, then corrected, then confirmed, and the
-- corrected version needs to reach the same people.
--
-- `lib/notifications/playerNewsAttemptLedger.ts` fingerprints the content and can already spot
-- a change — but only for rows still inside the candidate window. It cannot bring a stamped row
-- back, because `player_news` records only `created_at`, so there is nothing to compare the
-- stamp against.
--
-- ── ⚠ THE CODE THAT READS THIS COLUMN CANNOT SHIP BEFORE IT IS APPLIED ──────────────────────
--
-- Prisma's generated client selects every scalar a model declares unless a query names an
-- explicit `select`. The moment `schema.prisma` carries `updatedAt` on this model, every
-- PlayerNewsRecord read without an explicit select issues SQL naming a column production does
-- not have, and Postgres refuses it — P2022. So the ordering is all-or-nothing:
--
--   1. apply THIS migration
--   2. add `updatedAt DateTime @updatedAt @map("updated_at")` to `model PlayerNewsRecord`
--   3. then widen the candidate query to
--        notification_dispatched_at IS NULL OR updated_at > notification_dispatched_at
--
-- The query in the service today is deliberately NOT written against this column. Reversing the
-- order takes the news path down rather than degrading it.
--
-- ── BACKFILL SEMANTICS ──────────────────────────────────────────────────────────────────────
--
-- ⚠ EXISTING ROWS ARE SEEDED FROM `created_at`, NOT FROM `now()`. Seeding from `now()` would
-- make `updated_at > notification_dispatched_at` true for EVERY row already dispatched, and the
-- first sweep after deploy would re-notify the entire look-back window. `created_at` is always
-- at or before the stamp, so nothing becomes retroactively eligible.

ALTER TABLE "player_news"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

UPDATE "player_news"
   SET "updated_at" = "created_at"
 WHERE "updated_at" IS NULL;

ALTER TABLE "player_news"
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Supports the widened candidate query: the sweep scans by dispatch state within a look-back
-- window, so both columns belong in the same index.
CREATE INDEX IF NOT EXISTS "player_news_dispatch_recheck_idx"
  ON "player_news" ("notification_dispatched_at", "updated_at");
