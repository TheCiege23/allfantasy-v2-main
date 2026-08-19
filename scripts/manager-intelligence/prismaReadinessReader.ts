/**
 * Decision OS Manager Intelligence Platform — Phase 6.
 *
 * READ-ONLY prisma implementation of `ReadinessReader`. It performs only
 * `findFirst`/`count` reads — no writes, ever — and touches only persisted
 * league facts (never a recommendation/AI endpoint). It is dynamically imported
 * by `validate-nonprod-readonly.ts` ONLY after the safety gate passes, so the
 * pure guard/probe logic and its tests stay database-free.
 */

import { prisma } from '@/lib/prisma'
import type { ReadinessCounts, ReadinessReader } from './nonprodValidationGuard'

const COMPLETED_TRADE_STATUSES = ['completed', 'complete', 'accepted']

export function createPrismaReadinessReader(): ReadinessReader {
  return {
    async readLeagueReadiness(leagueId: string): Promise<ReadinessCounts | null> {
      const season = await prisma.redraftSeason.findFirst({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      if (!season) return null

      const [rosterCount, activePlayerCount, matchupCount, completedTradeCount] = await Promise.all([
        prisma.redraftRoster.count({ where: { seasonId: season.id } }),
        prisma.redraftRosterPlayer.count({ where: { roster: { seasonId: season.id }, droppedAt: null } }),
        prisma.redraftMatchup.count({ where: { seasonId: season.id } }),
        prisma.redraftLeagueTrade
          .count({ where: { leagueId, status: { in: COMPLETED_TRADE_STATUSES } } })
          .catch(() => 0),
      ])

      return { seasonFound: true, rosterCount, activePlayerCount, matchupCount, completedTradeCount }
    },
  }
}
