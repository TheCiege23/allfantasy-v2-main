-- Sleeper's NBA ids are independent of its NFL ids. Keep a separate, sport-scoped key.
ALTER TABLE "PlayerIdentityMap" ADD COLUMN "sleeperNbaId" TEXT;
CREATE UNIQUE INDEX "PlayerIdentityMap_sport_sleeperNbaId_key"
  ON "PlayerIdentityMap"("sport", "sleeperNbaId");

-- Backfill only a one-to-one match with identical name, position, and current team.
-- A team code that cannot be mapped, a traded player whose feeds disagree, and a
-- duplicate name/position are left unmapped for review rather than guessed.
WITH team_codes(name, code) AS (
  VALUES
    ('Atlanta Hawks','ATL'), ('Boston Celtics','BOS'), ('Brooklyn Nets','BKN'),
    ('Charlotte Hornets','CHA'), ('Chicago Bulls','CHI'), ('Cleveland Cavaliers','CLE'),
    ('Dallas Mavericks','DAL'), ('Denver Nuggets','DEN'), ('Detroit Pistons','DET'),
    ('Golden State Warriors','GSW'), ('Houston Rockets','HOU'), ('Indiana Pacers','IND'),
    ('Los Angeles Clippers','LAC'), ('Los Angeles Lakers','LAL'), ('Memphis Grizzlies','MEM'),
    ('Miami Heat','MIA'), ('Milwaukee Bucks','MIL'), ('Minnesota Timberwolves','MIN'),
    ('New Orleans Pelicans','NOP'), ('New York Knicks','NYK'), ('Oklahoma City Thunder','OKC'),
    ('Orlando Magic','ORL'), ('Philadelphia 76ers','PHI'), ('Phoenix Suns','PHX'),
    ('Portland Trail Blazers','POR'), ('Sacramento Kings','SAC'), ('San Antonio Spurs','SAS'),
    ('Toronto Raptors','TOR'), ('Utah Jazz','UTA'), ('Washington Wizards','WAS')
), candidates AS (
  SELECT i.id AS identity_id, s."sleeperId" AS sleeper_id,
    count(*) OVER (PARTITION BY i.id) AS identity_matches,
    count(*) OVER (PARTITION BY s."sleeperId") AS sleeper_matches
  FROM "PlayerIdentityMap" i
  JOIN "SportsPlayer" r ON r.sport = 'NBA' AND r.source = 'rolling_insights'
    AND r."externalId" = i."rollingInsightsId"
  JOIN team_codes t ON t.name = r.team
  JOIN "SportsPlayer" s ON s.sport = 'NBA' AND s.source = 'sleeper'
    AND s.team = t.code AND s."sleeperId" IS NOT NULL
    AND lower(trim(s.name)) = lower(trim(r.name))
    AND s.position = r.position
  WHERE i.sport = 'NBA' AND i."sleeperNbaId" IS NULL
    AND lower(trim(i."canonicalName")) = lower(trim(r.name))
    AND i.position = r.position
)
UPDATE "PlayerIdentityMap" i SET "sleeperNbaId" = c.sleeper_id
FROM candidates c
WHERE i.id = c.identity_id AND c.identity_matches = 1 AND c.sleeper_matches = 1;
