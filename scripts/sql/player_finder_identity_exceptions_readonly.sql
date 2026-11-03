-- Player Finder roster exceptions. SELECT only. Run each statement separately against
-- the intended database. Public provider IDs are retained so a reviewer can trace
-- a row; no identity link is written by this report.

-- Sleeper NBA: every distinct roster ID, including missing source rows.
WITH roster_ids AS (
  SELECT e.value #>> '{}' AS player_id, count(DISTINCT l.id) AS leagues
  FROM leagues l JOIN rosters r ON r."leagueId" = l.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r."playerData"->'players','[]'::jsonb)) e(value)
  WHERE l.sport::text = 'NBA' AND l.platform = 'sleeper'
  GROUP BY 1
), source_rows AS (
  SELECT ids.player_id, ids.leagues, s.name, s.position, s.team, s.dob,
    i.id AS identity_id
  FROM roster_ids ids
  LEFT JOIN "SportsPlayer" s ON s.sport='NBA' AND s.source='sleeper' AND s."sleeperId"=ids.player_id
  LEFT JOIN "PlayerIdentityMap" i ON i.sport='NBA' AND i."sleeperNbaId"=ids.player_id
)
SELECT player_id, leagues, name, position, team, identity_id,
  CASE WHEN identity_id IS NOT NULL THEN 'linked'
       WHEN name IS NULL THEN 'missing_sleeper_source'
       WHEN team IS NULL THEN 'source_no_team'
       ELSE 'source_team_unlinked_needs_independent_evidence' END AS review_reason
FROM source_rows ORDER BY review_reason, player_id;

-- Fantrax NCAAF: the imported metadata has names in "Last, First" order and
-- positions, but no team. A unique name/position candidate is review evidence,
-- not permission to link: a second independent ID or verified team is required.
WITH roster_ids AS (
  SELECT e.value #>> '{}' AS player_id, count(DISTINCT l.id) AS leagues
  FROM leagues l JOIN rosters r ON r."leagueId" = l.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r."playerData"->'players','[]'::jsonb)) e(value)
  WHERE l.sport::text='NCAAF' AND l.platform='fantrax'
  GROUP BY 1
), metadata AS (
  SELECT ids.player_id, ids.leagues,
    max(r."playerData"->'player_metadata'->ids.player_id->>'name') AS name,
    max(r."playerData"->'player_metadata'->ids.player_id->>'position') AS position,
    count(DISTINCT concat_ws('|', r."playerData"->'player_metadata'->ids.player_id->>'name',
      r."playerData"->'player_metadata'->ids.player_id->>'position'))
      FILTER (WHERE r."playerData"->'player_metadata' ? ids.player_id) AS metadata_variants
  FROM roster_ids ids JOIN rosters r ON r."playerData"->'players' ? ids.player_id
  JOIN leagues l ON l.id=r."leagueId" AND l.sport::text='NCAAF' AND l.platform='fantrax'
  GROUP BY ids.player_id, ids.leagues
), candidates AS (
  SELECT m.player_id, count(i.id) AS name_position_candidates
  FROM metadata m LEFT JOIN "PlayerIdentityMap" i ON i.sport='NCAAF'
    AND i."normalizedName"=lower(trim(split_part(m.name,',',2)||' '||split_part(m.name,',',1)))
    AND i.position=m.position
  GROUP BY m.player_id
)
SELECT m.player_id, m.leagues, m.name, m.position, m.metadata_variants,
  c.name_position_candidates, i.id AS identity_id,
  CASE WHEN i.id IS NOT NULL THEN 'linked'
       WHEN m.name IS NULL THEN 'missing_metadata'
       WHEN m.metadata_variants>1 THEN 'conflicting_metadata'
       WHEN c.name_position_candidates=0 THEN 'no_exact_name_position_candidate'
       WHEN c.name_position_candidates=1 THEN 'unique_name_position_unverified'
       ELSE 'ambiguous_name_position' END AS review_reason
FROM metadata m JOIN candidates c USING(player_id)
LEFT JOIN "PlayerIdentityMap" i ON i.sport='NCAAF' AND i."fantraxId"=m.player_id
ORDER BY review_reason, m.player_id;
