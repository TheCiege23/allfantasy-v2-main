-- A trade the manager is part-way through building.
--
-- WHY A TABLE AND NOT A JSON COLUMN
-- The Trade Center already saves drafts, in `localStorage`, and the banner says
-- so because that was the honest thing to ship without a migration. It means a
-- deal built on a phone is not there on a laptop. The alternative considered and
-- rejected was stuffing it into an existing JSON column on a user row — say
-- `UserProfile.dashboardOnboarding` — which would have confused the next person
-- to read that column far more than it helped here.
--
-- WHY ONE PER (user, league)
-- The builder holds one deal at a time. A list of drafts is a different feature
-- with a different UI, and the unique constraint is what makes "save" idempotent
-- instead of accumulating a row per click.
--
-- WHY `payload` IS UNSTRUCTURED
-- A draft is a scratchpad. Nothing joins to it, nothing aggregates it, and it is
-- read back only by the screen that wrote it. Giving it a schema would mean a
-- migration every time the builder learns a new asset class — and the builder is
-- expected to learn several (idols, weapons, serums are already named in its
-- legend and refused by its picker).
--
-- SAFE TO RUN BEFORE THE CODE SHIPS. Nothing reads this table until the Trade
-- Center does, and the Trade Center falls back to the browser when the read
-- fails — so the order of operations does not matter.
CREATE TABLE IF NOT EXISTS "TradeDraft" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "leagueId"  TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TradeDraft_userId_leagueId_key"
  ON "TradeDraft" ("userId", "leagueId");

CREATE INDEX IF NOT EXISTS "TradeDraft_userId_idx"
  ON "TradeDraft" ("userId");
