-- Native draft player IDs can include names and position/team qualifiers. Preserve the
-- full identifier in both the raw signal and aggregate trend tables.
ALTER TABLE "player_meta_trends" ALTER COLUMN "playerId" TYPE VARCHAR(128);
ALTER TABLE "trend_signal_events" ALTER COLUMN "playerId" TYPE VARCHAR(128);
