-- Bounded rollup replacing the write-only `player_identity_mismatch_logs` table.
--
-- WHY THIS EXISTS
-- `player_identity_mismatch_logs` reached 2,126,004 rows / 787 MB in production (631 MB heap +
-- 154 MB indexes) -- 73% of a 1043 MB database -- and was never read once: zero code readers,
-- zero inbound FKs, zero dependent views, zero triggers, zero publications. It grew that large
-- because lib/player-identity/playerMismatchLogger.ts issued one un-awaited INSERT per player
-- per draft-pool resolve, so the same facts were re-recorded on every draft-room open. Measured
-- redundancy: 2,126,004 raw rows carried 60,987 distinct facts (97.13% duplicates); the worst
-- single league wrote 512,840 rows carrying 3,981 distinct facts.
--
-- This table keys on the fact rather than the sighting, so re-opening a draft room bumps a
-- counter instead of appending rows. Same signal, ~1.3% of the rows.
--
-- SAFETY
-- Purely additive: creates one new table and its indexes, IF NOT EXISTS throughout. Touches no
-- existing table and rewrites no data. `player_identity_mismatch_logs` is intentionally left in
-- place here -- it is dropped in a separate, explicitly approved step once
-- scripts/backfill-player-mismatch-stats.ts has folded its history into this table.
--
-- KEY CHOICE
-- `fingerprint` (sha256 of the key tuple, computed by mismatchFingerprint()) is the primary key.
-- A composite UNIQUE over the natural columns would not dedupe: league_id/player_name/position/
-- team are all nullable, and Postgres treats NULLs as distinct in a UNIQUE constraint.

CREATE TABLE IF NOT EXISTS "player_identity_mismatch_stats" (
    "fingerprint" VARCHAR(64) NOT NULL,
    "league_id" TEXT,
    "sport" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "player_name" VARCHAR(256),
    "position" VARCHAR(64),
    "team" VARCHAR(64),
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_pool_player_id" VARCHAR(128),
    "last_pool_external_id" VARCHAR(128),
    "last_sports_player_record_id" VARCHAR(128),
    "last_attempted_match_type" VARCHAR(32),
    "last_confidence" DECIMAL(5,4),
    "last_details" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_identity_mismatch_stats_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX IF NOT EXISTS "player_identity_mismatch_stats_sport_reason_idx" ON "player_identity_mismatch_stats"("sport", "reason");
CREATE INDEX IF NOT EXISTS "player_identity_mismatch_stats_league_id_idx" ON "player_identity_mismatch_stats"("league_id");
CREATE INDEX IF NOT EXISTS "player_identity_mismatch_stats_last_seen_at_idx" ON "player_identity_mismatch_stats"("last_seen_at");
