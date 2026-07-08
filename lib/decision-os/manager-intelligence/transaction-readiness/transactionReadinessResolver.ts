/**
 * Decision OS Manager Intelligence Platform — Phase 4.
 *
 * Live, read-only Transaction Readiness provider. Resolves the requesting user's
 * roster (canonical read-only identity resolver — no owner repair, no writes),
 * reads the season's current week + sport and the league's settings, resolves the
 * canonical roster-size config (`resolveRedraftRosterConfig`), loads the roster's
 * active players, and runs the pure `aggregateTransactionReadiness`.
 *
 * Read-only: at most four findFirst/findMany reads, zero writes. Consumes NO
 * recommendation/AI/waiver/trade endpoint — only persisted roster + league facts.
 * The caller owns auth (session + league membership).
 */

import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { aggregateTransactionReadiness } from './transactionReadinessAggregator'
import type { ManagerTransactionReadinessV1 } from './types'

export interface TransactionReadinessResolverArgs {
  userId: string
  leagueId: string
}

export interface TransactionReadinessDataProvider {
  /** Returns the contract, or null when the user has no roster / no active players. */
  getManagerTransactionReadiness(args: TransactionReadinessResolverArgs): Promise<ManagerTransactionReadinessV1 | null>
}

export function createLiveTransactionReadinessDataProvider(): TransactionReadinessDataProvider {
  return {
    async getManagerTransactionReadiness({ userId, leagueId }) {
      const lookup = await resolveRedraftRosterLookupReadOnly({ userId, leagueId })
      const roster = lookup.roster
      if (!roster) return null

      const [season, league, players] = await Promise.all([
        prisma.redraftSeason.findFirst({ where: { id: roster.seasonId }, select: { currentWeek: true, sport: true } }),
        prisma.league.findFirst({ where: { id: roster.leagueId }, select: { settings: true } }),
        prisma.redraftRosterPlayer.findMany({
          where: { rosterId: roster.id, droppedAt: null },
          select: { slotType: true, injuryStatus: true, byeWeek: true, droppedAt: true },
        }),
      ])

      // Canonical, deterministic roster-size config (commissioner settings → default).
      const config = resolveRedraftRosterConfig(season?.sport ?? 'nfl', league?.settings ?? null)

      return aggregateTransactionReadiness({
        players,
        currentWeek: season?.currentWeek ?? null,
        rosterConfig: { maxRosterSize: config.maxRosterSize, source: config.source },
      })
    },
  }
}
