-- Survivor theme + idols handoff: idol types as rows, and the commissioner idol setup.
-- Additive. Seeds the 20 catalog idol types; re-running leaves edited rows alone.

CREATE TABLE IF NOT EXISTS "survivor_idol_types" (
  "id" VARCHAR(48) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "glow" VARCHAR(16) NOT NULL,
  "category" VARCHAR(16) NOT NULL,
  "tier" INTEGER NOT NULL,
  "alwaysIn" BOOLEAN NOT NULL DEFAULT false,
  "shortText" TEXT NOT NULL,
  "powerText" TEXT NOT NULL,
  "whenText" VARCHAR(120) NOT NULL,
  "targetText" VARCHAR(120) NOT NULL,
  "enginePowerType" VARCHAR(64),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_idol_types_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "survivor_idol_types_isActive_sortOrder_idx" ON "survivor_idol_types"("isActive", "sortOrder");

INSERT INTO "survivor_idol_types" ("id", "name", "glow", "category", "tier", "alwaysIn", "shortText", "powerText", "whenText", "targetText", "enginePowerType", "sortOrder") VALUES
  ('immunity', 'Immunity idol', '#f2c94c', 'Protection', 3, true, 'Cancels every vote against you.', 'Cancels every vote cast against you at one Tribal Council.', 'Before votes close', 'Yourself', 'vote_shield', 0),
  ('tribe-immunity', 'Tribe immunity', '#3fd0b4', 'Protection', 3, true, 'Your whole tribe skips Tribal Council.', 'Your whole tribe is safe this week and skips Tribal Council.', 'Before the week locks', 'Your tribe', NULL, 1),
  ('steal-three', 'Steal 3', '#e5484d', 'Roster', 3, false, 'Take 3 players from any team.', 'Take any 3 players from one team''s roster and add them to yours.', 'Any week before playoffs', 'One team, 3 players', 'triple_steal', 2),
  ('point-surge', 'Point surge', '#22d3ee', 'Scoring', 2, false, 'Boosts your score for one week.', 'Adds a scoring boost to your team for one week. The commissioner sets the size, e.g. +15%.', 'Before the week locks', 'Your team', NULL, 3),
  ('vote-steal', 'Vote steal', '#a78bfa', 'Votes', 2, false, 'Take someone''s vote and cast it.', 'Take another manager''s vote at Tribal Council and cast it yourself.', 'Before votes close', 'One manager', 'vote_steal', 4),
  ('lineup-lock', 'Lineup lock', '#f59e0b', 'Scoring', 2, false, 'Freeze an opponent''s lineup.', 'Freeze an opponent''s lineup for one week. No swaps, no waivers.', 'Before the week locks', 'One opponent', NULL, 5),
  ('extra-vote', 'Extra vote', '#5b9cf0', 'Votes', 2, false, 'Cast a second vote.', 'Cast a second vote at Tribal Council.', 'Before votes close', 'Yourself', 'extra_vote', 6),
  ('idol-nullifier', 'Idol nullifier', '#84cc16', 'Votes', 2, false, 'Cancels another manager''s idol.', 'Cancels another manager''s idol the moment they play it.', 'Before votes close', 'One manager', NULL, 7),
  ('captain', 'Captain''s mark', '#fb923c', 'Scoring', 2, false, 'One starter scores double.', 'Pick one starter. Their points count double this week.', 'Before that player''s game', 'One starter', NULL, 8),
  ('safety-net', 'Safety net', '#38bdf8', 'Scoring', 1, false, 'Your score can''t drop below average.', 'Your score this week can''t fall below your season average.', 'Before the week locks', 'Your team', NULL, 9),
  ('injury-shield', 'Injury shield', '#4ade80', 'Scoring', 1, false, 'An injured starter still scores.', 'One injured or inactive starter scores his projection instead of zero.', 'Before that player''s game', 'One starter', NULL, 10),
  ('bye-cover', 'Bye cover', '#e9c46a', 'Scoring', 1, false, 'Starters on bye score their average.', 'Starters on a bye week score their season average this week.', 'Before the week locks', 'Your team', NULL, 11),
  ('silence', 'Silence', '#cbd5e1', 'Votes', 2, false, 'Block one manager from voting.', 'Block one manager from casting a vote at this week''s Tribal Council.', 'Before votes close', 'One manager', NULL, 12),
  ('spyglass', 'Spyglass', '#99f6e4', 'Votes', 1, false, 'See one manager''s vote early.', 'See who one manager voted for before the reveal.', 'After they vote, before the reveal', 'One manager', NULL, 13),
  ('revote', 'Revote', '#e879f9', 'Votes', 3, false, 'Forces a second round of voting.', 'Throws out your Tribal Council result and forces a second round of voting.', 'During the reveal, before the verdict', 'Your Tribal Council', NULL, 14),
  ('tribute', 'Tribute', '#fb7185', 'Scoring', 2, false, 'Take 10% of an opponent''s points.', 'Take 10% of one opponent''s points this week and add them to yours.', 'Before the week locks', 'One opponent', NULL, 15),
  ('second-chance', 'Second chance', '#ff7a45', 'Game', 3, false, 'Bring a manager back from Exile.', 'Bring one voted-out manager (including yourself) back from Exile Island right away.', 'Any time before the merge', 'One exiled manager', NULL, 16),
  ('defector', 'Defector', '#14b8a6', 'Game', 2, false, 'Switch to another tribe.', 'Move to another tribe before the next Tribal Council.', 'Before the week locks', 'Yourself', NULL, 17),
  ('first-claim', 'First claim', '#93c5fd', 'Roster', 1, false, 'Your next waiver claim goes first, free.', 'Your next waiver claim processes first and costs no FAAB.', 'Before waivers run', 'Your next claim', NULL, 18),
  ('decoy', 'Decoy', '#9ca3af', 'Bluff', 1, false, 'Wastes a Spyglass or nullifier on you.', 'A bluff. Any Spyglass or Idol nullifier used on you is wasted.', 'Passive once owned', 'Yourself', NULL, 19)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "survivor_idol_configs" (
  "id" TEXT NOT NULL,
  "leagueId" VARCHAR(64) NOT NULL,
  "mode" VARCHAR(8) NOT NULL DEFAULT 'random',
  "count" INTEGER NOT NULL DEFAULT 7,
  "hideFromCommish" BOOLEAN NOT NULL DEFAULT false,
  "pickedTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "resolvedTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "resolvedAt" TIMESTAMP(3),
  "pointSurgePct" INTEGER NOT NULL DEFAULT 15,
  "tributePct" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survivor_idol_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "survivor_idol_configs_leagueId_key" ON "survivor_idol_configs"("leagueId");

DO $$ BEGIN
  ALTER TABLE "survivor_idol_configs" ADD CONSTRAINT "survivor_idol_configs_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The handoff default is 7 idols per league (6, 7 or 8). Existing rows keep their value.
ALTER TABLE "leagues" ALTER COLUMN "survivorIdolCount" SET DEFAULT 7;
