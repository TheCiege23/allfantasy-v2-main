import "server-only"
import { prisma } from "@/lib/prisma"
import { getWorldCupOfficialGroupsReadiness } from "./worldCupDataSyncService"

export type WorldCupOperationsReadiness = {
  provider: {
    name: string
    configured: boolean
    apiKeyPresent: boolean
  }
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
    standingsSynced: boolean
    liveSyncRouteAvailable: boolean
    bestThirdMappingConfigured: boolean
  }
}

function clean(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function getWorldCupProviderOpsStatus(env: NodeJS.ProcessEnv = process.env) {
  const provider = clean(env.WORLD_CUP_DATA_PROVIDER) ?? "mock"
  const apiKeyPresent =
    provider === "apifootball"
      ? Boolean(clean(env.API_SPORTS_KEY) ?? clean(env.API_FOOTBALL_KEY) ?? clean(env.APISPORTS_FOOTBALL_KEY) ?? clean(env.RAPIDAPI_KEY))
      : provider === "sportsdata"
        ? Boolean(clean(env.SPORTSDATA_API_KEY))
        : provider === "manual"
          ? true
          : false

  return {
    name: provider,
    configured: provider !== "mock" && apiKeyPresent,
    apiKeyPresent,
  }
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
  const [groupsReadiness, fixtureCount, standingsCount] = await Promise.all([
    getWorldCupOfficialGroupsReadiness({ seasonYear }),
    prisma.worldCupBracketMatch.count({
      where: {
        ...(input.challengeId ? { challengeId: input.challengeId } : {}),
        startsAt: { not: null },
      },
    }),
    prisma.worldCupGroupTeam.count({
      where: {
        ...(input.challengeId ? { challengeId: input.challengeId } : {}),
        actualRank: { not: null },
      },
    }),
  ])

  return {
    provider: getWorldCupProviderOpsStatus(),
    origins: getWorldCupOriginOpsStatus(),
    data: {
      groupsComplete: groupsReadiness.ready,
      assignedTeams: groupsReadiness.assignedTeams,
      incompleteGroups: groupsReadiness.incompleteGroups,
      fixtureCount,
      standingsSynced: standingsCount >= 48,
      liveSyncRouteAvailable: true,
      bestThirdMappingConfigured: isWorldCupBestThirdMappingConfigured(),
    },
  }
}
