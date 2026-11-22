BEGIN;
-- Official NBA boxes retain separate provenance. Existing sources and their
-- identity-space/kind restrictions remain unchanged. This adds NBA game coverage only.
ALTER TABLE "sports_stat_coverage" DROP CONSTRAINT "sports_stat_coverage_check1";
ALTER TABLE "sports_stat_coverage" ADD CONSTRAINT "sports_stat_coverage_check1" CHECK (
  (kind = 'game' AND "identitySpace" = 'canonical' AND
    (source = 'rolling_insights_live' OR (sport = 'NBA' AND source = 'nba_official_live')))
  OR (kind = 'week' AND "identitySpace" = 'sleeper' AND source = 'sleeper_weekly_stats')
);
COMMIT;
