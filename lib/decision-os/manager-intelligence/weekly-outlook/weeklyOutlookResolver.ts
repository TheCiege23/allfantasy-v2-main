/**
 * Decision OS Manager Intelligence Platform — Phase 3.
 *
 * Live, read-only Weekly Outlook provider. Resolves the requesting user's roster
 * (canonical read-only identity resolver — no owner repair, no writes), reads the
 * season's current week, the current-week `RedraftMatchup` row (deterministic
 * projected points + status + opponent), and REUSES the read-only Team Health
 * aggregator for the lineup signal. It then runs the pure `aggregateWeeklyOutlook`.
 *
 * Read-only: at most three findFirst/findMany reads, zero writes. Consumes NO
 * recommendation/AI endpoint and does NOT modify the Team Health contract — only
 * reads its output. The caller owns auth (session + league membership).
 */

import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'
import { aggregateManagerTeamHealth } from '@/lib/decision-os/manager-intelligence/team-health/teamHealthAggregator'
import { aggregateWeeklyOutlook } from './weeklyOutlookAggregator'
import type { ManagerWeeklyOutlookV1, WeeklyOutlookLineupInput, WeeklyOutlookMatchupInput } from './types'

export interface WeeklyOutlookResolverArgs {
  userId: string
  leagueId: string
}

export interface WeeklyOutlookDataProvider {
  /** Returns the contract, or null when the user has no roster in this league. */
  getManagerWeeklyOutlook(args: WeeklyOutlookResolverArgs): Promise<ManagerWeeklyOutlookV1 | null>
}

export function createLiveWeeklyOutlookDataProvider(): WeeklyOutlookDataProvider {
  return {
    async getManagerWeeklyOutlook({ userId, leagueId }) {
      const lookup = await resolveRedraftRosterLookupReadOnly({ userId, leagueId })
      const roster = lookup.roster
      if (!roster) return null

      const season = await prisma.redraftSeason.findFirst({
        where: { id: roster.seasonId },
        select: { currentWeek: true },
      })
      const currentWeek = season?.currentWeek ?? null

      // Lineup signal via the reused, read-only Team Health aggregator.
      const players = await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: roster.id, droppedAt: null },
        select: { slotType: true, injuryStatus: true, byeWeek: true, droppedAt: true },
      })
      const health = aggregateManagerTeamHealth({ players, currentWeek })
      const lineup: WeeklyOutlookLineupInput = {
        // roster is resolved (non-null) above → hasRoster is always true here.
        hasRoster: true,
        starterCount: health?.starterCount ?? 0,
        injuredStarterCount: health?.injuredStarterCount ?? 0,
        questionableStarterCount: health?.questionableStarterCount ?? 0,
        byeWeekStarterCount: health?.byeWeekStarterCount ?? 0,
      }

      // Current-week matchup (deterministic projected points + status + opponent).
      let matchup: WeeklyOutlookMatchupInput | null = null
      if (currentWeek != null && currentWeek > 0) {
        const row = await prisma.redraftMatchup.findFirst({
          where: {
            seasonId: roster.seasonId,
            week: currentWeek,
            OR: [{ homeRosterId: roster.id }, { awayRosterId: roster.id }],
          },
          select: {
            week: true,
            status: true,
            homeRosterId: true,
            awayRosterId: true,
            homeProjected: true,
            awayProjected: true,
            homeRoster: { select: { teamName: true, ownerName: true } },
            awayRoster: { select: { teamName: true, ownerName: true } },
          },
        })
        if (row) {
          const isHome = row.homeRosterId === roster.id
          const opponent = isHome ? row.awayRoster : row.homeRoster
          matchup = {
            hasMatchup: true,
            week: row.week,
            status: row.status,
            userProjected: isHome ? row.homeProjected : row.awayProjected,
            opponentProjected: isHome ? row.awayProjected : row.homeProjected,
            opponentName: opponent ? opponent.teamName ?? opponent.ownerName ?? null : null,
          }
        }
      }

      return aggregateWeeklyOutlook({ currentWeek, matchup, lineup })
    },
  }
}
