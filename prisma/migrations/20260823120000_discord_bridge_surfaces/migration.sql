-- 32a — Discord bridge: map more than one AllFantasy surface per league.
--
-- ⚠ THIS TARGETED THE WRONG TABLE NAME AND COULD NEVER HAVE APPLIED ANYWHERE.
-- It said ALTER TABLE "discord_league_channels" — the Prisma MODEL name — but the
-- model carries @@map("discord_league_channels"), so that relation does not
-- exist on any database. Corrected 2026-08-30 after a `migrate deploy` on
-- production failed with 42P01 `relation "DiscordLeagueChannel" does not exist`.
-- Zero statements had run (applied_steps_count = 0), so nothing was partially
-- applied and the fix is a rename, not a repair.
--
-- The index name was corrected the same way: Prisma derives constraint names
-- from the MAPPED table, so the sibling indexes on this table are
-- discord_league_channels_leagueId_guildId_key and friends. Matching that keeps
-- a future `migrate diff` from seeing drift it would then try to "fix".
--
-- The original header said this file was deliberately not run and that
-- `migrate deploy` should not be reached for, because .env pointed at
-- production. That warning was well-founded and is preserved as history: it is
-- exactly what happened. It is applied now as a deliberate, authorised
-- production step rather than an incidental one.
--
-- ⚠ THE PRISMA MODEL STILL DOES NOT DECLARE `surface` OR `commissionerOnly`.
-- Adding columns the schema does not know about is harmless at runtime — Prisma
-- ignores unmapped columns — but `prisma migrate dev` WILL see them as drift and
-- propose dropping them. Land the model fields before anyone runs migrate dev.
--
-- ⚠ ADDITIVE AND BACKWARD-COMPATIBLE ON PURPOSE. Every existing row is a league
-- chat mapping, which is exactly what the bridge relays today, so the column
-- defaults to 'league_chat' and existing rows keep working untouched. Nothing
-- reads `surface` until it exists; the UI renders an explicit "not mapped yet"
-- state for the other three surfaces in the meantime.

ALTER TABLE "discord_league_channels"
  ADD COLUMN IF NOT EXISTS "surface" VARCHAR(32) NOT NULL DEFAULT 'league_chat';

-- One mapping per (league, surface). `channelId` stays globally unique — a
-- single Discord channel must not be the target of two different surfaces, which
-- is how a commissioner note ends up in the trades channel.
CREATE UNIQUE INDEX IF NOT EXISTS "discord_league_channels_leagueId_surface_key"
  ON "discord_league_channels" ("leagueId", "surface");

-- Commissioner notes default to OFF wherever a row is created for them. The
-- default lives here as well as in application code because "a private note that
-- appears in a public Discord channel is the kind of mistake you only make once"
-- and a row inserted by a future script must not be able to skip that rule.
ALTER TABLE "discord_league_channels"
  ADD COLUMN IF NOT EXISTS "commissionerOnly" BOOLEAN NOT NULL DEFAULT false;
