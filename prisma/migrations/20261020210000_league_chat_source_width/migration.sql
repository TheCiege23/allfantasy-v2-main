-- Survivor tribe huddles are addressed as `tribe_<uuid>` (42 characters) on
-- league_chat_messages.source, which was VARCHAR(16). Every huddle send failed
-- with "value too long" at the database. Widen the column; no data changes.
ALTER TABLE "league_chat_messages" ALTER COLUMN "source" TYPE VARCHAR(64);
