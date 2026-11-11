/**
 * Aggregates platform-wide KPIs for the Admin Dashboard.
 * Used by Platform Overview panel.
 */

import { prisma } from "@/lib/prisma"
import { countRealLeagues } from "@/lib/demo-league/analyticsExclusion"
import type { PlatformOverviewMetrics } from "./types"

const SPORTS = ["NFL", "NHL", "NBA", "MLB", "NCAAF", "NCAAB", "SOCCER"] as const

export async function getPlatformOverview(): Promise<PlatformOverviewMetrics> {
  const now = new Date()
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const [
    totalUsers,
    activeLeagues,
    bracketsCreated,
    draftsActive,
    tradesToday,
    activeUsersToday,
  ] = await Promise.all([
    prisma.appUser.count(),
    // Real leagues only: "Create a test league" leagues are a tester's throwaway.
    countRealLeagues(),
    prisma.bracketLeague.count(),
    prisma.mockDraft.count({ where: { createdAt: { gte: new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000) } } }),
    prisma.leagueTrade.count({
      where: {
        tradeDate: {
          gte: startOfToday,
          lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.analyticsEvent
      .findMany({
        where: { createdAt: { gte: startOfToday }, userId: { not: null } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((rows) => rows.length),
  ])

  return {
    totalUsers,
    activeUsersToday,
    activeLeagues,
    bracketsCreated,
    draftsActive,
    tradesToday,
  }
}

export async function getPlatformOverviewCached(
  cacheMs: number = 60 * 1000
): Promise<PlatformOverviewMetrics> {
  return getPlatformOverview()
}
