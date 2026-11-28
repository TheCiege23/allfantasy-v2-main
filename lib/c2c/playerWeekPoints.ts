import { prisma } from '@/lib/prisma'

/**
 * One week's stored fantasy points for a C2C roster's players, keyed by playerId — read from PlayerWeeklyScore, the
 * table lib/c2c/scoringEngine.ts sums into the side totals. One query for the roster. A player whose (sport, week,
 * season) row does not exist is left out, so the screen shows nothing rather than a 0 that was never scored.
 */
export async function c2cPlayerWeekPoints(
  rows: ReadonlyArray<{ playerId: string; sport: string }>,
  week: number,
  season: number,
): Promise<Record<string, number>> {
  if (!rows.length) return {}
  const scores = await prisma.playerWeeklyScore.findMany({
    where: { playerId: { in: rows.map((r) => r.playerId) }, week, season },
    select: { playerId: true, sport: true, fantasyPts: true },
  })
  const sportOf = new Map(rows.map((r) => [r.playerId, r.sport]))
  const out: Record<string, number> = {}
  for (const s of scores) {
    if (sportOf.get(s.playerId) !== s.sport || typeof s.fantasyPts !== 'number') continue
    out[s.playerId] = s.fantasyPts
  }
  return out
}
