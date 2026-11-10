-- Durable evidence from complete provider responses. It has no cache TTL and
-- cannot be read or written by anonymous/authenticated database roles.
CREATE TABLE IF NOT EXISTS public.sports_stat_coverage (
  sport TEXT NOT NULL,
  source TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('game', 'week')),
  "identitySpace" TEXT NOT NULL CHECK ("identitySpace" IN ('canonical', 'sleeper')),
  season INTEGER NOT NULL,
  week INTEGER,
  "startTime" TIMESTAMPTZ NOT NULL,
  "endTime" TIMESTAMPTZ NOT NULL,
  teams TEXT[] NOT NULL CHECK (cardinality(teams) >= 2),
  "participantIds" TEXT[] NOT NULL CHECK (cardinality("participantIds") > 0),
  "gameKeys" TEXT[] NOT NULL CHECK (cardinality("gameKeys") > 0),
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, source, "periodId"),
  CHECK ("endTime" >= "startTime"),
  CHECK ((kind = 'game' AND "identitySpace" = 'canonical' AND source = 'rolling_insights_live')
      OR (kind = 'week' AND "identitySpace" = 'sleeper' AND source = 'sleeper_weekly_stats'))
);
CREATE INDEX IF NOT EXISTS sports_stat_coverage_window_idx ON sports_stat_coverage (sport, "startTime");
CREATE INDEX IF NOT EXISTS sports_stat_coverage_week_idx ON sports_stat_coverage (sport, season, week);
ALTER TABLE sports_stat_coverage ENABLE ROW LEVEL SECURITY;

-- Existing proofs cannot establish when a final response was first observed.
-- Start their correction window now; a later complete provider fetch is required.
ALTER TABLE public.sports_stat_coverage ADD COLUMN IF NOT EXISTS "firstFinalObservedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

-- An incomplete provider refresh must invalidate only its own game's proof.
-- Keep the app's no-table-DELETE boundary; expose the one bounded maintenance
-- operation through a definer owned by the existing migration role.
CREATE OR REPLACE FUNCTION public.af_invalidate_provider_stat_coverage(
  p_sport text, p_source text, p_period_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $invalidate$
DECLARE affected integer;
BEGIN
  IF p_sport IS NULL OR p_sport NOT IN ('NFL', 'NBA', 'NHL', 'MLB')
    OR p_source IS DISTINCT FROM 'rolling_insights_live'
    OR p_period_id IS NULL OR length(p_period_id) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'Invalid provider game coverage identity';
  END IF;
  DELETE FROM public.sports_stat_coverage
    WHERE sport = p_sport AND source = p_source AND "periodId" = p_period_id
      AND kind = 'game' AND "identitySpace" = 'canonical';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$invalidate$;
REVOKE ALL ON FUNCTION public.af_invalidate_provider_stat_coverage(text, text, text) FROM PUBLIC;
DO $coverage_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commish_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.sports_stat_coverage TO commish_app;
    GRANT EXECUTE ON FUNCTION public.af_invalidate_provider_stat_coverage(text, text, text) TO commish_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sports_stat_coverage'::regclass
      AND polname = 'restricted_backend_select') THEN
      CREATE POLICY restricted_backend_select ON public.sports_stat_coverage FOR SELECT TO commish_app USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sports_stat_coverage'::regclass
      AND polname = 'restricted_backend_insert') THEN
      CREATE POLICY restricted_backend_insert ON public.sports_stat_coverage FOR INSERT TO commish_app WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.sports_stat_coverage'::regclass
      AND polname = 'restricted_backend_update') THEN
      CREATE POLICY restricted_backend_update ON public.sports_stat_coverage FOR UPDATE TO commish_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
END
$coverage_grants$;
