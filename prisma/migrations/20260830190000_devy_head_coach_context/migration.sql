-- Head-coach context and SP+ offence on the devy player row.
--
-- WHY THESE COLUMNS EXIST
-- A devy asset is a claim on a player's future NFL outcome, and the single
-- largest thing that can change that claim without the player doing anything is
-- the staff around him. `DevyPlayer` carried usage, PPA, WEPA, SP+ overall and
-- returning production — everything about the team EXCEPT who is coaching it.
-- A running back whose programme changed hands in December is a materially
-- different asset in March, and nothing on the row said so.
--
-- WHY head_coach_season EXISTS SEPARATELY FROM stat_season
-- The coach feed is per-year and the stat feed lags it. Without its own stamp a
-- reader cannot tell whether the coach named here led the season the stat line
-- describes. This is the same reason passing_profile_season was added alongside
-- stat_season rather than reusing it.
--
-- WHY THE HIRE DATE IS STORED AND TENURE IS NOT
-- `/coaches?year=N` filters each coach's seasons array to N, so a single call
-- carries no history to count consecutive seasons from. The alternative is to
-- derive tenure from the hire date, which requires guessing whether a coach
-- hired in November 2024 has his first season in 2024 (an in-season interim) or
-- 2025 (an offseason replacement) — the two are indistinguishable from the date
-- alone. A guessed integer would read as measured. The date is the fact.
--
-- WHY head_coach_changed IS NULLABLE AND MUST STAY THAT WAY
-- Three different situations produce "no change recorded": the prior season was
-- unreadable, the school had no primary coach that year (an even mid-season
-- split names nobody), or the coach genuinely stayed. Only the third is FALSE.
-- Collapsing the first two into FALSE would report continuity that nothing
-- measured — the same enrichment-as-truth failure that made DevyPlayer.devyValue
-- report 0 for players nobody had valued.
--
-- WHY team_sp_offense IS HERE AND COSTS NOTHING
-- ingestCFBDTeamContext ALREADY fetches /ratings/sp and already reads
-- offenseRating off the response to build CFBTeamSPRating; it simply never wrote
-- it. No new provider call is added by this column.
--
-- WHY ppa_season_total EXISTS WHEN ppa_total ALREADY DOES
-- `ppaTotal` does not hold what its name says. ingestCFBDUsageAndPPA writes
-- `averagePPA.all` into it — a PER-PLAY figure around 0.7 — not `totalPPA.all`,
-- which is the season sum and runs 20-400. They are different quantities and
-- only one of them predicts anything. Measured across eight recruit classes,
-- splitting players who took meaningful snaps at the median:
--
--     season total   QB 32.5x  RB 22.8x  WR 175.8x  TE 30.9x
--     per-play avg   QB  2.2x  RB  1.9x  WR   0.9x  TE  0.9x
--
-- The per-play average is INVERTED for WR and TE — a ten-snap specialist rates
-- level with a workhorse. Renaming or repurposing `ppaTotal` would silently
-- change what every existing consumer reads, so the season total gets its own
-- column and the two are documented as non-interchangeable.
--
-- ⚠ WHAT THIS IS NOT. CFBD's /coaches carries HEAD COACHES ONLY. It cannot say
-- whether the offensive coordinator changed, which is the stronger signal for a
-- skill player. Nothing downstream should describe these columns as scheme or
-- play-calling data.

ALTER TABLE "DevyPlayer" ADD COLUMN "headCoachSeason" INTEGER;
ALTER TABLE "DevyPlayer" ADD COLUMN "headCoachName" VARCHAR(96);
ALTER TABLE "DevyPlayer" ADD COLUMN "headCoachHireDate" TIMESTAMP(3);
ALTER TABLE "DevyPlayer" ADD COLUMN "headCoachChanged" BOOLEAN;
ALTER TABLE "DevyPlayer" ADD COLUMN "teamSpOffense" DOUBLE PRECISION;
ALTER TABLE "DevyPlayer" ADD COLUMN "ppaSeasonTotal" DOUBLE PRECISION;
