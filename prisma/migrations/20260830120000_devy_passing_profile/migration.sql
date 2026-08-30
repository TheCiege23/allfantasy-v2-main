-- Air yards, ADOT, pass location and YAC on the devy player row.
--
-- WHY THESE COLUMNS EXIST
-- CFBD published five passing endpoints on 2026-08-30 that split passing
-- production into where the ball was thrown and what happened after it arrived.
-- Until now `DevyPlayer` carried `passingYards` and `passingTDs` and nothing
-- else, so two quarterbacks with the same yardage were the same player to every
-- consumer — including `draftProjectionScore`, which is the column the whole
-- devy board orders on. Air yards separate the passer from his receivers.
--
-- WHY THE DENOMINATORS ARE STORED AND NOT DERIVED
-- `airYardsAttempts` and `yacCompletions` are not redundant with `passAttempts`
-- and `passCompletions`. CFBD's own coverage note says 2025 is partial "with
-- richer detail concentrated later in the season" and that even 2026 games can
-- have gaps, and its aggregate responses ship availability counts for exactly
-- this reason. A reader that computes ADOT as airYards/passAttempts gets a
-- number deflated by every throw the feed never measured — smoothly, plausibly,
-- and worst for the players with the least data. Storing the real denominator
-- is what makes the ratio checkable.
--
-- WHY NULLABLE, AND WHY 0 IS NOT THE DEFAULT
-- The same rule the rest of this table already follows. NULL means "not
-- measured"; 0 means "threw it at the line of scrimmage". A default of 0 would
-- publish a fabricated ADOT for all ~1,718 rows on the day this shipped, which
-- is the failure `devyValue` already demonstrates: it is 0 for 1,237 rows and
-- nobody can tell an unscouted freshman from a player the board rates at
-- nothing.
--
-- WHY passingProfileSeason IS SEPARATE FROM statSeason
-- The passing feed does not go back as far as the stat feed. A player can hold
-- a current stat line and a season-old passing profile, and collapsing the two
-- would date one by the other.
--
-- IF NOT EXISTS throughout: the shared working tree means this file has to be
-- safe to replay, and every other recent migration here does the same.
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "passingProfileSeason" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "passAttempts" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "passCompletions" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "airYards" DOUBLE PRECISION;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "adot" DOUBLE PRECISION;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "airYardsAttempts" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "yardsAfterCatch" DOUBLE PRECISION;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "yacCompletions" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "passLocations" JSONB;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "teamPassAdot" DOUBLE PRECISION;
ALTER TABLE "DevyPlayer" ADD COLUMN IF NOT EXISTS "teamPassYacPerComp" DOUBLE PRECISION;
