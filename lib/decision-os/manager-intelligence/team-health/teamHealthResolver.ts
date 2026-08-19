/**
 * Decision OS Manager Intelligence Platform — Phase 2.
 *
 * Live, read-only Team Health provider. Resolves the requesting user's roster
 * in a league (via the canonical read-only identity resolver — no owner repair,
 * no writes), loads that roster's active players + the season's current week,
 * and runs the pure `aggregateManagerTeamHealth` aggregator.
 *
 * Read-only: at most three findFirst/findMany reads, zero writes. It consumes
 * NO recommendation/AI/scoring code — only persisted roster + season facts.
 * The caller is responsible for auth (session + league membership); this
 * provider takes an already-authenticated userId.
 */

import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'
import { aggregateManagerTeamHealth } from './teamHealthAggregator'
import type { ManagerTeamHealthV1 } from './types'

export interface TeamHealthResolverArgs {
  userId: string
  leagueId: string
}

export interface TeamHealthDataProvider {
  /** Returns the contract, or null when the user has no roster / no active players. */
  getManagerTeamHealth(args: TeamHealthResolverArgs): Promise<ManagerTeamHealthV1 | null>
}

export function createLiveTeamHealthDataProvider(): TeamHealthDataProvider {
  return {
    async getManagerTeamHealth({ userId, leagueId }) {
      // 1. Identity: which RedraftRoster belongs to this user in this league?
      const lookup = await resolveRedraftRosterLookupReadOnly({ userId, leagueId })
      const roster = lookup.roster
      if (!roster) return null

      // 2. Current week for bye-impact (0/absent → no bye counted).
      const season = await prisma.redraftSeason.findFirst({
        where: { id: roster.seasonId },
        select: { currentWeek: true },
      })

      // 3. Active roster players (dropped excluded at the query, and again defensively
      //    in the aggregator). Only the three fields the aggregator needs.
      const players = await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: roster.id, droppedAt: null },
        select: { slotType: true, injuryStatus: true, byeWeek: true, droppedAt: true },
      })

      return aggregateManagerTeamHealth({
        players,
        currentWeek: season?.currentWeek ?? null,
      })
    },
  }
}
