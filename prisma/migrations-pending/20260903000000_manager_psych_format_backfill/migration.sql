-- R4b.1 — backfill manager_psych_profiles.format and manager_psych_profile_seasons.format
-- from each row's owning league. One-time: going forward, the write path
-- (ProfileRefreshService -> PsychologicalProfileEngine, plus the two admin routes and
-- RelationshipInsightOrchestrator) resolves and writes format on every run via
-- lib/league-runtime/leagueFormat.ts:deriveLeagueFormat. This statement is that same rule
-- written in SQL, for the rows that predate the code change.
--
-- Measured 2026-09-03 against production:
--   manager_psych_profiles:          1,749 rows, 0 with format set.
--   manager_psych_profile_seasons:      97 rows, 0 with format set.
--   leagues."leagueType": 0 NULLs, 5 distinct values observed (redraft, dynasty,
--     guillotine, zombie, survivor) — no keeper/bestball/devy rows exist yet, so this
--     backfill only ever produces one of those five plus 'dynasty'/'redraft' via the
--     isDynasty fallback.
--
-- ⚠ KNOWN LIMITATION, NOT FIXED HERE, SAME AS EVERY OTHER CONSUMER OF THIS DERIVATION.
-- leagueType and isDynasty can disagree (filed as BUG-4). Measured 2026-09-03: 4 of 270
-- leagues carry leagueType='redraft' with isDynasty=true; leagueType wins (checked first,
-- matching deriveLeagueFormat), so those 4 leagues' profiles backfill as 'redraft' with
-- isDynasty silently discarded. This statement does not invent a second, different
-- tiebreak for psychology specifically — it stays consistent with canonicalLeagueRules.ts
-- and every other format-dependent feature.
--
-- 48 of 1,749 manager_psych_profiles rows have a leagueId with no matching leagues row
-- (orphaned FK, pre-existing and out of scope here). The FROM-join below leaves those NULL
-- rather than guessing; they are not silently dropped, just not touched.
--
-- Idempotent: both statements are scoped to `format IS NULL`, so a second run only touches
-- rows that still have no format — including ones this same statement could not previously
-- reach because their league row did not exist yet.

UPDATE manager_psych_profiles p
SET format = COALESCE(NULLIF(TRIM(l."leagueType"), ''), CASE WHEN l."isDynasty" THEN 'dynasty' ELSE 'redraft' END)
FROM leagues l
WHERE l.id = p."leagueId"
  AND p.format IS NULL;

UPDATE manager_psych_profile_seasons s
SET format = COALESCE(NULLIF(TRIM(l."leagueType"), ''), CASE WHEN l."isDynasty" THEN 'dynasty' ELSE 'redraft' END)
FROM leagues l
WHERE l.id = s."leagueId"
  AND s.format IS NULL;
