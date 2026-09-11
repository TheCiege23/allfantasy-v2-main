-- CreateEnum
CREATE TYPE "LeagueTeamLifecycleState" AS ENUM ('UNKNOWN', 'CURRENT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeagueTeamManagerKind" AS ENUM ('UNKNOWN', 'HUMAN', 'VACANT', 'AI');

-- AlterTable
ALTER TABLE "league_teams" ADD COLUMN     "archiveReason" VARCHAR(64),
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "eliminatedAt" TIMESTAMP(3),
ADD COLUMN     "lifecycleState" "LeagueTeamLifecycleState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "managerKind" "LeagueTeamManagerKind" NOT NULL DEFAULT 'UNKNOWN';

