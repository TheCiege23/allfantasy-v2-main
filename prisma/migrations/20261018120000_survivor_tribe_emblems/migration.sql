-- Survivor tribe emblems: catalogue identity + commissioner colour overrides on each tribe.
-- Additive only. colorHex is untouched and stays the UI accent colour.
ALTER TABLE "survivor_tribes" ADD COLUMN IF NOT EXISTS "catalogId" VARCHAR(32);
ALTER TABLE "survivor_tribes" ADD COLUMN IF NOT EXISTS "primaryColor" VARCHAR(7);
ALTER TABLE "survivor_tribes" ADD COLUMN IF NOT EXISTS "secondaryColor" VARCHAR(7);

-- Backfill catalogue ids from the static crest URL tribes were provisioned with
-- (/survivor/tribes/crests/<sport>/<catalogId>.svg). Anything else (custom logos) stays NULL.
UPDATE "survivor_tribes"
SET "catalogId" = substring("logoUrl" from '^/survivor/tribes/crests/[a-z]+/([a-z]+)\.svg$')
WHERE "catalogId" IS NULL AND "logoUrl" ~ '^/survivor/tribes/crests/[a-z]+/[a-z]+\.svg$';
