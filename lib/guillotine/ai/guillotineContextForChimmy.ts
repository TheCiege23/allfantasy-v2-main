/**
 * [NEW] lib/guillotine/ai/guillotineContextForChimmy.ts
 * Build Guillotine league context for Chimmy when user is in a Guillotine league.
 * Deterministic data only. Chimmy never decides eliminations or chop outcomes.
 */

import { prisma } from '@/lib/prisma'
import { getGuillotineConfig } from '../GuillotineLeagueConfig'
import { buildGuillotineAIContext } from './GuillotineAIContext'

export async function buildGuillotineContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { guillotineMode: true, sport: true },
  })
  if (!league?.guillotineMode) return ''

  const config = await getGuillotineConfig(leagueId)
  if (!config) return ''

  try {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })

    const latestMatchup = await prisma.matchupFact.findFirst({
      where: { leagueId },
      orderBy: { weekOrPeriod: 'desc' },
      select: { weekOrPeriod: true },
    })
    const week = latestMatchup?.weekOrPeriod ?? 1

    const ctx = await buildGuillotineAIContext({
      leagueId,
      weekOrPeriod: week,
      type: 'survival',
      userRosterId: roster?.id,
    })
    if (!ctx) return ''

    const myStanding = ctx.survivalStandings.find((s) => s.rosterId === roster?.id)
    const myDanger = ctx.dangerTiers.find((d) => d.rosterId === roster?.id)

    return [
      `[GUILLY MODE CONTEXT — explanation only; you never decide eliminations or chop outcomes.]`,
      `League: Guilly. Sport: ${league.sport}. Week: ${ctx.weekOrPeriod}.`,
      `Elimination starts week ${config.eliminationStartWeek}. Tiebreaker: ${config.tiebreakerOrder?.[0] ?? 'points_for'}.`,
      `Remaining teams: ${ctx.survivalStandings.length}. Chopped this week: ${ctx.choppedThisWeek.length}.`,
      myStanding ? `Your rank: #${myStanding.rank} (${myStanding.seasonPointsCumul.toFixed(1)} cumulative PF).` : '',
      myDanger ? `Your danger tier: ${myDanger.tier}. Points from chop zone: ${myDanger.pointsFromChopZone.toFixed(1)}.` : '',
      `You may answer: am I in danger, what do I need to survive, who got chopped, how does elimination work.`,
      `Always use deterministic data; never invent chop outcomes.`,
    ].filter(Boolean).join('\n')
  } catch {
    return ''
  }
}
