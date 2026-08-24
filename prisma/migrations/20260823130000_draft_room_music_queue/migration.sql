-- 31a — the draft room's collaborative music queue.
--
-- ⚠ NOT APPLIED. Authored and committed, deliberately not run. The only database
-- this repo's .env.local points at is production; apply this against a
-- non-production database first (.env.test / ep-muddy-leaf), verify, and only
-- then schedule the prod apply. Do not reach for `prisma migrate deploy` here.
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
  FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
