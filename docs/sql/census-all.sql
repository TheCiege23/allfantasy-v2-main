-- AF CENSUS — READ ONLY. Paste this whole file into the Neon SQL editor, database = neondb.
-- Every statement is a SELECT. Nothing here creates, alters, writes or drops.
-- Table names verified against prisma/schema.prisma (two keep CamelCase and must stay quoted).

-- Q0 · right database? MUST say neondb.
SELECT current_database() AS db,
       CASE WHEN current_database()='neondb' THEN 'OK' ELSE 'WRONG DB - switch and re-run' END AS verdict;

-- Q1 · is the AF projection engine producing rows, and how stale?
SELECT sport, season, COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE week IS NULL) AS week_null,
       COUNT(*) FILTER (WHERE week IS NOT NULL) AS week_scoped,
       COUNT(DISTINCT "playerId") AS players,
       MAX("computedAt") AS newest,
       NOW() - MAX("computedAt") AS staleness
FROM "AFProjectionSnapshot" GROUP BY sport, season ORDER BY sport, season DESC;

-- Q2 · are the new rest-of-season columns populated yet?
-- Expect with_ros = 0 until compute-projections next runs. That is fine, not a fault.
SELECT COUNT(*) AS total, COUNT("rosProjection") AS with_ros, COUNT("rosWeeksRemaining") AS with_weeks
FROM "AFProjectionSnapshot";

-- Q3 · THE HEADLINE. AF rows vs the table the value engine used to read.
SELECT (SELECT COUNT(*) FROM "AFProjectionSnapshot") AS af_rows,
       (SELECT COUNT(*) FROM fantasy_projections) AS fp_rows,
       (SELECT COUNT(*) FROM fantasy_projections WHERE expires_at >= NOW()) AS fp_live,
       (SELECT COUNT(DISTINCT "playerId") FROM "AFProjectionSnapshot") AS af_players,
       (SELECT COUNT(DISTINCT player_id) FROM fantasy_projections) AS fp_players;

-- Q4 · IDP coverage. with_amounts = 0 would make the league-rescore path a no-op.
SELECT position, COUNT(*) AS rows,
       COUNT(*) FILTER (WHERE "adjustmentFactors" -> 'idp' IS NOT NULL) AS with_idp,
       COUNT(*) FILTER (WHERE "adjustmentFactors" -> 'idp' -> 'componentAmounts' IS NOT NULL) AS with_amounts
FROM "AFProjectionSnapshot"
WHERE sport='NFL' AND position IN ('LB','OLB','ILB','MLB','DB','CB','S','SS','FS','DL','DT','DE','NT','EDGE')
GROUP BY position ORDER BY rows DESC;

-- Q5 · which basis is winning? Heavy season_dk_fppg_proxy = mostly prior-season proxy.
SELECT sport, "adjustmentFactors" ->> 'basis' AS basis, "confidenceLevel", COUNT(*) AS rows
FROM "AFProjectionSnapshot" GROUP BY sport, basis, "confidenceLevel" ORDER BY sport, rows DESC;

-- Q6 · kickers. Flat min/max = no real signal (there is no kicker scoring path).
SELECT position, "adjustmentFactors" ->> 'basis' AS basis, COUNT(*) AS rows,
       ROUND(MIN("afProjection")::numeric,2) AS min_proj, ROUND(MAX("afProjection")::numeric,2) AS max_proj
FROM "AFProjectionSnapshot" WHERE position IN ('K','PK','P') GROUP BY position, basis ORDER BY rows DESC;

-- Q7 · 🛑 THE JOIN. Do AF playerIds resolve onto the identity spine?
-- af_rows_joining = 0 with af_players > 0 means the new value wiring returns nothing,
-- and would look exactly like "the engine has not computed these players".
SELECT (SELECT COUNT(DISTINCT "playerId") FROM "AFProjectionSnapshot" WHERE sport='NFL') AS af_nfl_players,
       (SELECT COUNT(*) FROM "AFProjectionSnapshot" a WHERE a.sport='NFL'
          AND EXISTS (SELECT 1 FROM "PlayerIdentityMap" m WHERE m.id = a."playerId")) AS af_rows_joining;

-- Q8 · market board (FantasyCalc), by format.
SELECT format, "qbFormat", source, COUNT(*) AS rows, COUNT(DISTINCT "sleeperId") AS players,
       MAX("capturedAt") AS newest
FROM "PlayerValueSnapshot" GROUP BY format, "qbFormat", source ORDER BY rows DESC;

-- Q9 · persisted trade snapshots. NOT_GRADED share = the three hardcoded nulls, measured.
SELECT grade, COUNT(*) AS rows, ROUND(AVG("confidenceScore")::numeric,1) AS avg_conf, MAX("createdAt") AS newest
FROM redraft_trade_value_snapshots GROUP BY grade ORDER BY rows DESC;

-- Q10 · cron health. If compute-projections is failing, Q1 is stale by definition.
SELECT job_name, status, COUNT(*) AS runs, SUM(rows_written) AS written, MAX(started_at) AS last_run
FROM sync_job_runs
WHERE job_name IN ('cron-compute-projections','cron-import-stat-lines','cron-adp-refresh')
GROUP BY job_name, status ORDER BY job_name, runs DESC;
