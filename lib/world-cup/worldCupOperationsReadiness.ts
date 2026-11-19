import "server-only"
import { prisma } from "@/lib/prisma"
import { getWorldCupOfficialGroupsReadiness } from "./worldCupDataSyncService"

type WorldCupOperationsReadiness = {
  provider: {
    name: string
    configured: boolean
    apiKeyPresent: boolean
    leagueId: string | null
    leagueIdConfigured: boolean
    cronSecretPresent: boolean
    missingEnvVars: string[]
  }
  challenge?: {
    bracketTeamsSeeded: number
  } | null
  origins: {
    productionSafe: boolean
    values: {
      nextAuthUrl: string | null
      nextPublicAppUrl: string | null
      appUrl: string | null
      publicSiteUrl: string | null
    }
  }
  data: {
    groupsComplete: boolean
    assignedTeams: number
    incompleteGroups: Array<{ groupName: string; teamCount: number; missingTeams: number }>
    fixtureCount: number
    groupStageFixtureCount: number
    knockoutFixtureCount: number
    knockoutFixturesAvailable: boolean
    venueKnownCount: number
    venueTbdCount: number
    kickoffKnownCount: number
    kickoffMissingCount: number
    standingsRowCount: number
    standingsSynced: boolean
    standingsState: "unavailable" | "pre_tournament" | "live" | "final"
    thirdPlaceRankingPresent: boolean
    liveSyncRouteAvailable: boolean
    bestThirdMappingConfigured: boolean
    groupStageReady: boolean
    knockoutsReady: boolean
    productionStatus: "ready" | "partial_ready" | "not_ready"
    warnings: string[]
  }
}

function clean(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function getWorldCupProviderOpsStatus(env: NodeJS.ProcessEnv = process.env) {
  const provider = clean(env.WORLD_CUP_DATA_PROVIDER) ?? "mock"
  const leagueId = provider === "apifootball"
    ? clean(env.API_FOOTBALL_WORLD_CUP_LEAGUE_ID) ?? clean(env.API_SPORTS_WORLD_CUP_LEAGUE_ID) ?? "1"
    : null
  const leagueIdConfigured = provider === "apifootball"
    ? Boolean(clean(env.API_FOOTBALL_WORLD_CUP_LEAGUE_ID) ?? clean(env.API_SPORTS_WORLD_CUP_LEAGUE_ID))
    : true
  const apiKeyPresent =
    provider === "apifootball"
      ? Boolean(clean(env.API_SPORTS_KEY) ?? clean(env.API_FOOTBALL_KEY) ?? clean(env.APISPORTS_FOOTBALL_KEY) ?? clean(env.RAPIDAPI_KEY))
      : provider === "sportsdata"
        ? Boolean(clean(env.SPORTSDATA_API_KEY))
        : provider === "manual"
          ? true
          : false
  const cronSecretPresent = Boolean(clean(env.WORLD_CUP_CRON_SECRET))
  const missingEnvVars = [
    provider === "mock" ? "WORLD_CUP_DATA_PROVIDER" : null,
    provider === "apifootball" && !leagueIdConfigured ? "API_FOOTBALL_WORLD_CUP_LEAGUE_ID" : null,
    provider === "apifootball" && !apiKeyPresent ? "API_SPORTS_KEY or API_FOOTBALL_KEY" : null,
    provider === "sportsdata" && !apiKeyPresent ? "SPORTSDATA_API_KEY" : null,
    !cronSecretPresent ? "WORLD_CUP_CRON_SECRET" : null,
  ].filter((name): name is string => Boolean(name))

  return {
    name: provider,
    configured: provider !== "mock" && apiKeyPresent,
    apiKeyPresent,
    leagueId,
    leagueIdConfigured,
    cronSecretPresent,
    missingEnvVars,
  }
}

function resolveStandingsState(input: {
  standingsRowsCount: number
  activeStandingsRowsCount: number
  completedStandingsRowsCount: number
}): "unavailable" | "pre_tournament" | "live" | "final" {
  if (input.standingsRowsCount < 48) return "unavailable"
  if (input.activeStandingsRowsCount === 0) return "pre_tournament"
  if (input.completedStandingsRowsCount >= 48) return "final"
  return "live"
}

export function getWorldCupOriginOpsStatus(env: NodeJS.ProcessEnv = process.env) {
  const values = {
    nextAuthUrl: clean(env.NEXTAUTH_URL),
    nextPublicAppUrl: clean(env.NEXT_PUBLIC_APP_URL),
    appUrl: clean(env.APP_URL),
    publicSiteUrl: clean(env.PUBLIC_SITE_URL) ?? clean(env.NEXT_PUBLIC_SITE_URL),
  }
  const required = [values.nextAuthUrl, values.nextPublicAppUrl]
  const allUrls = Object.values(values).filter((value): value is string => Boolean(value))
  const productionSafe =
    required.every(Boolean) &&
    allUrls.every((value) => {
      try {
        const url = new URL(value)
        return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)
      } catch {
        return false
      }
    })

  return { productionSafe, values }
}

export function isWorldCupBestThirdMappingConfigured(env: NodeJS.ProcessEnv = process.env) {
  return clean(env.WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED) === "true"
}

export async function getWorldCupOperationsReadiness(input: {
  challengeId?: string | null
  seasonYear?: number
} = {}): Promise<WorldCupOperationsReadiness> {
  const seasonYear = input.seasonYear ?? 2026
  const [
    groupsReadiness,
    bracketTeamsSeeded,
    fixtureCount,
    groupStageFixtureCount,
    knockoutFixtureCount,
    venueKnownCount,
    kickoffKnownCount,
    standingsRowsCount,
    activeStandingsRowsCount,
    completedStandingsRowsCount,
    thirdPlaceCandidateRowsCount,
    placeholderTeamCount,
  ] = await Promise.all([
    getWorldCupOfficialGroupsReadiness({ seasonYear }),
    input.challengeId
      ? prisma.worldCupGroupTeam.count({
          where: {
            challengeId: input.challengeId,
          },
        })
      : Promise.resolve(0),
    prisma.worldCupOfficialFixture.count({
      where: {
        seasonYear,
        tournamentKey: "fifa_world_cup",
      },
    }),
    prisma.worldCupOfficialFixture.count({
      where: {
        seasonYear,
        tournamentKey: "fifa_world_cup",
        stage: { startsWith: "Group Stage" },
      },
    }),
    prisma.worldCupOfficialFixture.count({
      where: {
        seasonYear,
        tournamentKey: "fifa_world_cup",
        round: { in: ["round_of_32", "round_of_16", "quarterfinal", "semifinal", "third_place", "final"] },
      },
    }),
    prisma.worldCupOfficialFixture.count({
      where: {
        seasonYear,
        tournamentKey: "fifa_world_cup",
        venueName: { not: null },
      },
    }),
    prisma.worldCupOfficialFixture.count({
      where: {
        seasonYear,
        tournamentKey: "fifa_world_cup",
        startsAt: { not: null },
      },
    }),
    prisma.worldCupOfficialGroupStanding.count({
      where: {
        seasonYear,
        actualRank: { not: null },
      },
    }),
    prisma.worldCupOfficialGroupStanding.count({
      where: {
        seasonYear,
        played: { gt: 0 },
      },
    }),
    prisma.worldCupOfficialGroupStanding.count({
      where: {
        seasonYear,
        played: { gte: 3 },
      },
    }),
    prisma.worldCupOfficialGroupStanding.count({
      where: {
        seasonYear,
        actualRank: 3,
      },
    }),
    prisma.worldCupTeam.count({
      where: {
        groupName: { not: null },
        OR: [
          { id: { startsWith: "demo_team_" } },
          { id: { startsWith: "wc2026_placeholder_" } },
          { qualificationStatus: { in: ["test", "test_placeholder"] } },
          { sourcePayload: { path: ["testFixture"], equals: true } },
          { sourcePayload: { path: ["source"], equals: "allfantasy_test_placeholder" } },
        ],
      },
    }),
  ])

  const bestThirdMappingConfigured = isWorldCupBestThirdMappingConfigured()
  const standingsSynced = standingsRowsCount >= 48
  const groupStageReady = groupsReadiness.ready && groupStageFixtureCount >= 72 && standingsSynced
  const knockoutsReady = knockoutFixtureCount > 0 && bestThirdMappingConfigured
  const productionStatus = groupStageReady && knockoutsReady
    ? "ready"
    : groupStageReady
      ? "partial_ready"
      : "not_ready"
  const warnings = [
    knockoutFixtureCount === 0
      ? "knockout_fixtures_pending: provider has not supplied Round of 32 or later fixtures yet."
      : null,
    bestThirdMappingConfigured
      ? null
      : "best_third_mapping_gated: keep WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED=false until FIFA mapping is official.",
    placeholderTeamCount > 0
      ? `world_cup_group_placeholders_present: ${placeholderTeamCount} demo/test group teams exist; production pools should use official 2026 group teams only.`
      : null,
  ].filter((warning): warning is string => Boolean(warning))

  return {
    provider: getWorldCupProviderOpsStatus(),
    challenge: input.challengeId ? { bracketTeamsSeeded } : null,
    origins: getWorldCupOriginOpsStatus(),
    data: {
      groupsComplete: groupsReadiness.ready,
      assignedTeams: groupsReadiness.assignedTeams,
      incompleteGroups: groupsReadiness.incompleteGroups,
      fixtureCount,
      groupStageFixtureCount,
      knockoutFixtureCount,
      knockoutFixturesAvailable: knockoutFixtureCount > 0,
      venueKnownCount,
      venueTbdCount: Math.max(0, fixtureCount - venueKnownCount),
      kickoffKnownCount,
      kickoffMissingCount: Math.max(0, fixtureCount - kickoffKnownCount),
      standingsRowCount: standingsRowsCount,
      standingsSynced,
      standingsState: resolveStandingsState({
        standingsRowsCount,
        activeStandingsRowsCount,
        completedStandingsRowsCount,
      }),
      thirdPlaceRankingPresent: thirdPlaceCandidateRowsCount >= 12,
      liveSyncRouteAvailable: true,
      bestThirdMappingConfigured,
      groupStageReady,
      knockoutsReady,
      productionStatus,
      warnings,
    },
  }
}
