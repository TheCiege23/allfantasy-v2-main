-- 32a — Discord bridge: map more than one AllFantasy surface per league.
--
-- ⚠ NOT APPLIED. This file is authored and committed but deliberately not run.
-- Applying it is an explicit, gated step, because the only database this repo's
-- .env.local points at is production. Run it against a non-production database
-- first (.env.test / ep-muddy-leaf), verify, and only then schedule the prod
-- apply. Do NOT reach for `prisma migrate deploy` here — see the repo's notes on
-- the inverted prod guard in the CLI wrapper scripts.
--
-- ⚠ ADDITIVE AND BACKWARD-COMPATIBLE ON PURPOSE. Every existing row is a league
-- chat mapping, which is exactly what the bridge relays today, so the column
-- defaults to 'league_chat' and existing rows keep working untouched. Nothing
-- reads `surface` until it exists; the UI renders an explicit "not mapped yet"
-- state for the other three surfaces in the meantime.

ALTER TABLE "DiscordLeagueChannel"
  ADD COLUMN IF NOT EXISTS "surface" VARCHAR(32) NOT NULL DEFAULT 'league_chat';

-- One mapping per (league, surface). `channelId` stays globally unique — a
-- single Discord channel must not be the target of two different surfaces, which
-- is how a commissioner note ends up in the trades channel.
CREATE UNIQUE INDEX IF NOT EXISTS "DiscordLeagueChannel_leagueId_surface_key"
  ON "DiscordLeagueChannel" ("leagueId", "surface");

-- Commissioner notes default to OFF wherever a row is created for them. The
-- default lives here as well as in application code because "a private note that
-- appears in a public Discord channel is the kind of mistake you only make once"
-- and a row inserted by a future script must not be able to skip that rule.
ALTER TABLE "DiscordLeagueChannel"
  ADD COLUMN IF NOT EXISTS "commissionerOnly" BOOLEAN NOT NULL DEFAULT false;
