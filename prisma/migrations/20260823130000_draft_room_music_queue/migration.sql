-- 31a — the draft room's collaborative music queue.
--
-- ⚠ THE FOREIGN KEY NAMED THE MODEL, NOT THE TABLE, SO THIS COULD NEVER APPLY.
-- It said REFERENCES "League"("id"), but the League model carries
-- @@map("leagues") — there is no relation called "League" on any database.
-- Corrected 2026-08-30 after a production `migrate deploy` failed with 42P01
-- `relation "League" does not exist`. Nothing had been applied at the point of
-- failure, so this is a rename rather than a repair.
--
-- Same defect as 20260823120000_discord_bridge_surfaces, authored the same day:
-- both wrote the Prisma MODEL name into raw SQL. A repo-wide scan of all 147
-- migrations against every @@map in schema.prisma found exactly these two, so
-- the pattern is contained rather than systemic.
--
-- `"DraftRoomQueueItem"` is left as-is deliberately: that model is not in
-- schema.prisma at all, so no @@map applies and the table name is what it says.
--
-- The original header said this was deliberately not run and that
-- `migrate deploy` should not be reached for, because .env pointed at
-- production. That warning was well-founded and is kept as history — it is
-- exactly what happened. It is applied now as a deliberate, authorised step.
--
-- ⚠ THE MODEL IS STILL ABSENT FROM schema.prisma. Prisma ignores tables it does
-- not know about, so this is harmless at runtime, but `prisma migrate dev` will
-- read it as drift and propose dropping it. Land the model before running that.
--
-- ⚠ THE QUEUE IS SHARED. THE AUDIO IS NOT. This table holds what the room has
-- lined up, and nothing else — there is no room-wide playback state because
-- Spotify's public API cannot broadcast audio to several listeners. Each person
-- plays the queue on their own authenticated device. Do not add a "position" or
-- "isPlaying" column here expecting it to synchronise anyone's speakers; it
-- would only encode a promise the platform cannot keep.

CREATE TABLE IF NOT EXISTS "DraftRoomQueueItem" (
  "id"           TEXT NOT NULL,
  "leagueId"     TEXT NOT NULL,
  -- Null for a league with no stored draft session; the queue still works.
  "draftId"      TEXT,
  "trackId"      VARCHAR(64) NOT NULL,
  "trackName"    TEXT NOT NULL,
  "artistName"   TEXT NOT NULL,
  "albumArt"     TEXT,
  "durationMs"   INTEGER NOT NULL DEFAULT 0,
  -- Spotify does not have a preview clip for every track. Null is a real value
  -- and the free-account fallback has to degrade gracefully when it is null.
  "previewUrl"   TEXT,
  "addedByUserId" TEXT NOT NULL,
  -- Denormalised so a queue row still renders if the profile read fails.
  "addedByName"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "playedAt"     TIMESTAMP(3),

  CONSTRAINT "DraftRoomQueueItem_pkey" PRIMARY KEY ("id")
);

-- The room reads its queue in insertion order, unplayed first.
CREATE INDEX IF NOT EXISTS "DraftRoomQueueItem_leagueId_createdAt_idx"
  ON "DraftRoomQueueItem" ("leagueId", "createdAt");

-- The same track twice in a row is nearly always a double-tap, not a request.
CREATE UNIQUE INDEX IF NOT EXISTS "DraftRoomQueueItem_leagueId_trackId_unplayed_key"
  ON "DraftRoomQueueItem" ("leagueId", "trackId")
  WHERE "playedAt" IS NULL;

ALTER TABLE "DraftRoomQueueItem"
  ADD CONSTRAINT "DraftRoomQueueItem_leagueId_fkey"
  FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
