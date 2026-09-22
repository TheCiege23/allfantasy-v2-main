-- Rollback: removes the constraint. No data is lost; duplicates simply become possible again.
DROP INDEX IF EXISTS "PlayerIdentityMap_sport_rollingInsightsId_key";
