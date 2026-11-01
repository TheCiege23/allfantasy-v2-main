ALTER TABLE "zombie_leagues"
  ADD COLUMN "experienceMode" VARCHAR(16) NOT NULL DEFAULT 'enhanced',
  ADD COLUMN "rulesSnapshot" JSONB;
