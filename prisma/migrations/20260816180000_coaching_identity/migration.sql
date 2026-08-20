CREATE TABLE IF NOT EXISTS "Coach" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "birthYear" INTEGER,
    "pfrId" TEXT,
    "coachingTreeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Coach_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Coach_nameNormalized_idx" ON "Coach"("nameNormalized");

CREATE TABLE IF NOT EXISTS "CoachStint" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "teamId" VARCHAR(8) NOT NULL,
    "teamRaw" VARCHAR(8) NOT NULL,
    "season" INTEGER NOT NULL,
    "role" VARCHAR(24) NOT NULL,
    "roleRaw" TEXT,
    "isPlayCaller" BOOLEAN,
    "source" VARCHAR(24) NOT NULL,
    "sourceConfidence" VARCHAR(8) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachStint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CoachStint_coachId_teamId_season_role_key"
  ON "CoachStint"("coachId", "teamId", "season", "role");

CREATE INDEX IF NOT EXISTS "CoachStint_teamId_season_idx" ON "CoachStint"("teamId", "season");
CREATE INDEX IF NOT EXISTS "CoachStint_season_role_idx" ON "CoachStint"("season", "role");

DO $$ BEGIN
  ALTER TABLE "CoachStint" ADD CONSTRAINT "CoachStint_coachId_fkey"
    FOREIGN KEY ("coachId") REFERENCES "Coach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
