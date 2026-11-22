import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { isIdpEligiblePosition } from '@/lib/af-projections/idpScoring'
import { extractSeasonAggregate } from '@/lib/af-projections/core'
import { RI_NCAAF_STAT_ALIASES, NCAAF_STAT_ALIASES } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { dkFantasyPoints, idpFantasyPoints } from '@/lib/stats/cfbdPlayerStats'

export const COLLEGE_FINAL_BOX_SOURCE = 'af_verified_college_boxes'
export const MIN_COLLEGE_FOOTBALL_GAMES = 2

const components = new Map(Object.entries(NCAAF_STAT_ALIASES).map(([input, key]) => [key, input]))
const extraComponents = {
  passing_attempts: 'passing.ATT',
  completions: 'passing.COMPLETIONS',
  rushing_attempts: 'rushing.CAR',
  field_goals_attempted: 'kicking.FGA',
  extra_points_attempted: 'kicking.XPA',
  fumbles: 'fumbles.FUM',
}
const statKeys = {
  ...Object.fromEntries(Object.entries(RI_NCAAF_STAT_ALIASES).flatMap(([input, key]) => {
    const dotted = components.get(key)
    return dotted ? [[input, dotted]] : []
  })),
  ...extraComponents,
} as Record<string, string>

type Box = { gameId: string; normalizedStatMap: unknown }
function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function collegeFootballBoxSeason(
  player: { canonicalName: string; currentTeam: string; position: string },
  boxes: readonly Box[],
) {
  const gameIds = new Set<string>()
  const totals: Record<string, number> = {}
  const defender = isIdpEligiblePosition(player.position)
  for (const { gameId, normalizedStatMap } of boxes) {
    const line = record(normalizedStatMap)
    if (line?.gameFinal !== true || line.seasonType !== 'regular' || gameIds.has(gameId)) continue
    const stats = record(line.stats)
    if (!stats) continue
    const values: Record<string, number> = {}
    for (const [input, dotted] of Object.entries(statKeys)) {
      // Sacks taken and defensive sacks can share a feed label. The verified role decides.
      if (dotted.startsWith('defensive.') && !defender) continue
      if (dotted.startsWith('interceptions.') && !defender) continue
      const amount = stats[input]
      if (typeof amount === 'number' && Number.isFinite(amount)) values[dotted] = amount
    }
    const played = defender
      ? ['defensive.TOT', 'defensive.SACKS', 'interceptions.INT'].some(key => values[key] > 0)
      : ['passing.ATT', 'rushing.CAR', 'receiving.REC', 'kicking.FGA', 'kicking.XPA',
        'kickReturns.TD', 'puntReturns.TD'].some(key => values[key] > 0)
    if (!played) continue
    gameIds.add(gameId)
    for (const [key, amount] of Object.entries(values)) totals[key] = (totals[key] ?? 0) + amount
  }
  if (gameIds.size < MIN_COLLEGE_FOOTBALL_GAMES) return null
  const defaultPoints = (defender ? idpFantasyPoints(totals) : dkFantasyPoints(totals)) ?? 0
  const verifiedGameIds = [...gameIds].sort()
  const regular_season = { ...Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))),
    games_played: gameIds.size, DK_fantasy_points: Math.round(defaultPoints * 100) / 100,
    DK_fantasy_points_per_game: Math.round(defaultPoints / gameIds.size * 100) / 100 }
  const verifiedBoxVersion = createHash('sha256').update(JSON.stringify([regular_season, verifiedGameIds])).digest('hex')
  return { riPlayerName: player.canonicalName, riTeam: player.currentTeam, position: player.position,
    verifiedGameIds, verifiedBoxVersion, regular_season } satisfies Prisma.InputJsonObject
}

type SeasonLine = { playerId: string; stats: unknown; source?: string; fetchedAt?: Date }
/** Treat the fallback as an alternate sample of the same season, never a second player or an extra game. */
export function pickCollegeFootballSeasonLines<T extends SeasonLine>(lines: T[]): T[] {
  const chosen = new Map<string, { line: T; games: number; priority: number }>()
  for (const line of lines) {
    const games = extractSeasonAggregate(line.stats)?.gamesPlayed ?? 0
    const priority = line.source === 'cfbd' ? 2 : line.source === COLLEGE_FINAL_BOX_SOURCE ? 1 : 0
    const prior = chosen.get(line.playerId)
    if (!prior || games > prior.games || (games === prior.games && (priority > prior.priority ||
      (priority === prior.priority && (line.fetchedAt?.getTime() ?? 0) > (prior.line.fetchedAt?.getTime() ?? 0))))) {
      chosen.set(line.playerId, { line, games, priority })
    }
  }
  return [...chosen.values()].map(row => row.line)
}
