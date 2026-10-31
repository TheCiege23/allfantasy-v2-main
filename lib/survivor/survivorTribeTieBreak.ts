/**
 * The key-position tribe tie-break's data: each tribe's best STARTER score at one position for one
 * week ("Tie Breaker will be the tribe with the highest scoring QB"). Read from our own scoring
 * (scoreRosterForWeek over stored stats) — never a provider call. Loaded only when tribe totals
 * tie (survivorCouncilImmunity.loadWeekTieBreak).
 *
 * NBA Survivor scores through its own per-game modes, which do not expose per-starter points here,
 * so an NBA league keeps today's tie-break (empty map → tribe id).
 */

import { prisma } from '@/lib/prisma'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { tribePositionLeaders } from './survivorWeeklyPrizes'

export async function loadTribePositionLeaderScores(
  leagueId: string,
  week: number,
  position: string,
  tribeIds: readonly string[],
): Promise<Map<string, number>> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  if (!league || String(league.sport).toUpperCase() === 'NBA') return new Map()
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { season: true } })
  if (!season) return new Map()
  const castaways = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active', tribeId: { in: [...tribeIds] } },
    select: { tribeId: true, redraftRosterId: true },
  })
  const rows: { tribeId: string; position: string | null; points: number; isStarter: boolean }[] = []
  for (const c of castaways) {
    if (!c.tribeId || !c.redraftRosterId) continue
    const bridge = await prisma.roster.findFirst({ where: { id: c.redraftRosterId, leagueId }, select: { redraftRosterId: true } })
    if (!bridge?.redraftRosterId) continue
    const score = await scoreRosterForWeek({ leagueId, rosterId: bridge.redraftRosterId, week, seasonYear: season.season, collectPlayerPoints: true })
    const starters = (score.playerPoints ?? []).filter((p) => p.isStarter)
    if (!starters.length) continue
    const positions = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: bridge.redraftRosterId, playerId: { in: starters.map((p) => p.playerId) } },
      select: { playerId: true, position: true },
    })
    const positionOf = new Map(positions.map((p) => [p.playerId, p.position]))
    for (const p of starters) rows.push({ tribeId: c.tribeId, position: positionOf.get(p.playerId) ?? null, points: p.points, isStarter: true })
  }
  return tribePositionLeaders(rows, position)
}
