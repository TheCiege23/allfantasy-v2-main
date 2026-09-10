/**
 * PowerRankingGenerator — builds context for power rankings from league standings.
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { GenerationContext, TeamStandingRow } from './types'
import { ACTIVE_TEAM_WHERE } from '@/lib/league-import/activeTeams'

export interface PowerRankingOptions {
  leagueId: string
  sport?: string | null
  leagueName?: string
  season?: string
}

/**
 * Build power-ranking context: teams ordered by rank (currentRank or computed from points/wins).
 */
export async function buildPowerRankingContext(
  options: PowerRankingOptions
): Promise<GenerationContext> {
  const sport = normalizeToSupportedSport(options.sport)
  const leagueId = options.leagueId

  const [teams, league] = await Promise.all([
    /* Power rankings rank the CURRENT league; an archived team must not appear in them. */
    prisma.leagueTeam.findMany({
      where: { ...ACTIVE_TEAM_WHERE, leagueId },
      orderBy: [{ currentRank: 'asc' }, { pointsFor: 'desc' }, { wins: 'desc' }],
    }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } }),
  ])

  const teamRows: TeamStandingRow[] = teams.map((t, i) => ({
    teamId: t.id,
    teamName: t.teamName,
    ownerName: t.ownerName,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties ?? 0,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
    rank: t.currentRank ?? i + 1,
  }))

  const highlights = teamRows.slice(0, 5).map((t, i) => `#${i + 1} ${t.teamName} (${t.wins}-${t.losses}, ${t.pointsFor.toFixed(1)} PF)`)

  return {
    leagueId,
    sport,
    leagueName: options.leagueName ?? league?.name ?? undefined,
    season: options.season,
    teams: teamRows,
    highlights,
  }
}
