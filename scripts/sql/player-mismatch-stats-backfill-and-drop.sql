-- One-shot: fold `player_identity_mismatch_logs` history into `player_identity_mismatch_stats`,
-- then drop the source table and reclaim its 787 MB.
--
-- ============================================================================================
-- DO NOT RUN THIS UNTIL:
--   1. The rollup writer is deployed and verified to be writing to player_identity_mismatch_stats.
--   2. `player_identity_mismatch_logs` has taken no new rows since that deploy (query below).
--   3. Guap has explicitly approved it, AND the Saturday 2026-07-18 demo window has passed.
-- ============================================================================================
--
-- WHY BACKFILL AT ALL
-- The source holds a real signal we already paid 787 MB to collect: 15,544 distinct players
-- across 7 sports whose identity never resolved during draft enrichment. Rolled up it is 60,987
-- rows (~1.3% of the raw volume), so keeping it costs almost nothing.
--
-- WHY BACKFILL AND DROP ARE ONE TRANSACTION
-- The INSERT uses ON CONFLICT DO UPDATE to ADD occurrences, so running it twice would silently
-- double every counter. Dropping the source in the same transaction makes a second run impossible
-- rather than merely discouraged: it either fully succeeds once, or rolls back leaving nothing
-- changed. There is no partial state and no re-run hazard.
--
-- COST / SAFETY
-- Sequential scan of the 632 MB heap, hashed into ~61k groups: aggregates are count/min/max only.
-- No array_agg and no jsonb accumulation -- those would materialize 2.1M JSONB values and are
-- exactly the shape that has OOM'd this instance before (Neon compute is 1-2 CU / 4-8 GB;
-- see memory `prod-postgres-oom-53200`). The DROP takes ACCESS EXCLUSIVE on the source, but
-- nothing reads or writes it (verified: 0 code readers, 0 FKs, 0 views, 0 triggers, 0
-- publications), and DROP unlinks files rather than rewriting them, so it is milliseconds.
-- NOTE: no VACUUM FULL is needed anywhere here. The table has 0 dead tuples -- its 787 MB is all
-- live rows -- so there is no bloat to compact. DROP reclaims 100% of it.
--
-- HOST CHECK -- READ THIS
-- Production is endpoint `ep-curly-block-ad0dlt9o` (branch br-withered-shadow-adur64u9, db
-- `neondb`). `ep-spring-tooth-adaoi9x1` is the DEV CLONE (branch br-restless-unit-adhut4n4,
-- named "claude-dashboard-local-dev").
--
-- FIXED 2026-08-20: the ~20 guard scripts this note warned about had PROD_HOST_MARKER set to
-- 'ep-spring-tooth' and so guarded the WRONG host. They now all delegate to
-- scripts/db-target-identity.cjs, which keys on the (endpoint, database) PAIR and fails closed.
-- Confirm the endpoint yourself anyway before running this:
--     SELECT current_setting('neon.endpoint_id'), current_database();
--
-- `last_*` COLUMNS ARE INTENTIONALLY NOT BACKFILLED
-- They hold the most recent observation of fields outside the key. Reconstructing them per group
-- needs a DISTINCT ON / array_agg over all 2.1M rows -- a large sort or a 2.1M-value JSONB
-- accumulation, which is the memory profile we are deliberately avoiding. They cost nothing to
-- leave NULL: the first live sighting of each fact fills them in. Counts, first_seen and
-- last_seen -- the parts that cannot be re-derived -- are all preserved.

-- --------------------------------------------------------------------------------------------
-- PRE-FLIGHT (run these on their own first; both are read-only)
--
--   -- 1. Confirm the host is production and not the dev clone:
--   SELECT current_setting('neon.endpoint_id') AS endpoint, current_database() AS db;
--
--   -- 2. Confirm the writer has stopped: max(created_at) must predate the rollup deploy,
--   --    and must not move between two runs of this query.
--   SELECT count(*) AS rows, max(created_at) AS last_write FROM player_identity_mismatch_logs;
--
--   -- 3. Preview the fold without writing (expect ~60,987 facts from 2,126,004 rows):
--   SELECT count(*) AS distinct_facts, sum(occurrences) AS sightings FROM (
--     SELECT count(*) AS occurrences FROM player_identity_mismatch_logs
--     WHERE btrim(coalesce(sport,'')) <> ''
--     GROUP BY nullif(btrim(league_id),''), upper(nullif(btrim(sport),'')), reason,
--              left(nullif(btrim(player_name),''),256), left(nullif(btrim(position),''),64),
--              left(nullif(btrim(team),''),64)
--   ) g;
-- --------------------------------------------------------------------------------------------

BEGIN;

WITH normalized AS (
  -- Mirrors normalize() in lib/player-identity/playerMismatchLogger.ts: trim, blank -> NULL,
  -- clamp to column width, uppercase sport. Historical rows must land on the same fingerprints
  -- that live writes produce, or the same fact would occupy two rows.
  SELECT
    nullif(btrim(league_id), '')                            AS league_id,
    upper(nullif(btrim(sport), ''))                         AS sport,
    reason,
    left(nullif(btrim(player_name), ''), 256)               AS player_name,
    left(nullif(btrim(position), ''), 64)                   AS position,
    left(nullif(btrim(team), ''), 64)                       AS team,
    created_at
  FROM player_identity_mismatch_logs
  -- sport is NOT NULL in the source and record() drops blank-sport payloads; belt and braces.
  WHERE btrim(coalesce(sport, '')) <> ''
),
rolled AS (
  SELECT
    league_id, sport, reason, player_name, position, team,
    count(*)::int   AS occurrences,
    min(created_at) AS first_seen_at,
    max(created_at) AS last_seen_at
  FROM normalized
  GROUP BY league_id, sport, reason, player_name, position, team
)
INSERT INTO player_identity_mismatch_stats (
  fingerprint, league_id, sport, reason, player_name, position, team,
  occurrences, first_seen_at, last_seen_at
)
SELECT
  -- Byte-identical to mismatchFingerprint() in lib/player-identity/playerMismatchLogger.ts.
  -- Verified against production: JS and this expression return the same digest for both a fully
  -- populated fact and the all-NULLs shape. chr(31)=field separator, chr(30)=NULL sentinel.
  encode(sha256(convert_to(concat_ws(chr(31),
    coalesce(league_id,   chr(30)),
    coalesce(sport,       chr(30)),
    coalesce(reason,      chr(30)),
    coalesce(player_name, chr(30)),
    coalesce(position,    chr(30)),
    coalesce(team,        chr(30))
  ), 'UTF8')), 'hex'),
  league_id, sport, reason, player_name, position, team,
  occurrences, first_seen_at, last_seen_at
FROM rolled
ON CONFLICT (fingerprint) DO UPDATE SET
  occurrences   = player_identity_mismatch_stats.occurrences + EXCLUDED.occurrences,
  first_seen_at = LEAST(player_identity_mismatch_stats.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at  = GREATEST(player_identity_mismatch_stats.last_seen_at, EXCLUDED.last_seen_at);
  -- last_* are deliberately absent: a live write may already have set them, and EXCLUDED's
  -- values are NULL here. Overwriting real observations with NULL would lose information.

-- Source of the 787 MB. Nothing reads it; the signal now lives in the rollup above.
DROP TABLE player_identity_mismatch_logs;

COMMIT;

-- --------------------------------------------------------------------------------------------
-- POST-CHECK
--   SELECT count(*) AS facts, sum(occurrences) AS sightings FROM player_identity_mismatch_stats;
--   -- expect ~60,987 facts / ~2,126,004 sightings (plus anything written live since deploy)
--
--   SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
--   -- expect ~288 MB, down from ~1075 MB
--
-- FOLLOW-UP: remove the PlayerIdentityMismatchLog model from prisma/schema.prisma and add a
-- `DROP TABLE IF EXISTS "player_identity_mismatch_logs";` migration so migration history matches
-- this database and a from-scratch build does not recreate the table.
-- --------------------------------------------------------------------------------------------
