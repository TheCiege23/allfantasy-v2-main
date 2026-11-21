import 'server-only'
import { prisma } from '@/lib/prisma'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'

/**
 * Points for a basketball half (NBA or NCAAB) of a college + pro league, over one scoring period.
 *
 * Read from the Rolling Insights box lines in `player_game_stats` (`rolling_insights_live`), keyed on
 * the identity id and reached through each Fantrax player's `rollingInsightsId`. Selected by GAME
 * DATE inside the period, the way native NBA C2C campus scoring selects them
 * (lib/c2c/campusScoring.ts `campusBasketballPointsForMatchup`). The same normalizer and the same
 * default scorer are used, and preseason rows are left out.
 *
 * ⚠ AN ESTIMATE, NOT FANTRAX'S NUMBER: the league's own Fantrax scoring settings are not applied.
 */

export type DailyPoints = {
  /** Fantrax player id → points. A player with no game this period is absent, not 0. */
  points: Record<string, number>
  /** Whether ANY box line exists for this sport in the period: false means stats have not arrived. */
  statsOnFile: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function loadDailyPoints(args: {
  sport: 'NBA' | 'NCAAB'
  /** `[start, end)` as UTC-midnight DATE keys, the form `game_date` is stored in. */
  window: { start: Date; end: Date }
  players: Array<{ id: string; rollingInsightsId: string | null; position: string | null }>
}): Promise<DailyPoints> {
  const sportKeys = [args.sport, args.sport.toLowerCase()]
  const riIds = [...new Set(args.players.map((p) => p.rollingInsightsId).filter((id): id is string => !!id))]
  const gameDate = { gte: args.window.start, lt: args.window.end }

  const [identities, anyRow] = await Promise.all([
    riIds.length
      ? prisma.playerIdentityMap.findMany({ where: { sport: args.sport, rollingInsightsId: { in: riIds } }, select: { id: true, rollingInsightsId: true } })
      : Promise.resolve([]),
    prisma.playerGameStat.findFirst({ where: { sportType: { in: sportKeys }, gameDate }, select: { id: true } }),
  ])
  const identityByRi = new Map(identities.map((i) => [i.rollingInsightsId!, i.id]))
  const playerByIdentity = new Map<string, { id: string; position: string | null }>()
  for (const p of args.players) {
    const identityId = p.rollingInsightsId ? identityByRi.get(p.rollingInsightsId) : undefined
    if (identityId) playerByIdentity.set(identityId, { id: p.id, position: p.position })
  }

  const rows = playerByIdentity.size
    ? await prisma.playerGameStat.findMany({
        where: { playerId: { in: [...playerByIdentity.keys()] }, sportType: { in: sportKeys }, gameDate },
        select: { playerId: true, normalizedStatMap: true, sportType: true, season: true, gameDate: true },
      })
    : []

  const byPlayer = new Map<string, unknown[]>()
  for (const row of rows) {
    if (resolveStoredSeasonType({ normalizedStatMap: row.normalizedStatMap, sport: row.sportType, season: row.season, gameDate: row.gameDate }) === 'pre') continue
    const who = playerByIdentity.get(row.playerId)
    if (!who) continue
    byPlayer.set(who.id, [...(byPlayer.get(who.id) ?? []), row.normalizedStatMap])
  }

  const normalizer = getDailySportNormalizer(args.sport)
  const scorer = buildLeagueStatScorer({ sport: args.sport, settings: null })
  const points: Record<string, number> = {}
  if (normalizer && scorer) {
    for (const [id, playerRows] of byPlayer) {
      const week = aggregateWeeklyStats(playerRows, normalizer)
      if (week.gamesCounted === 0) continue
      const position = args.players.find((p) => p.id === id)?.position ?? null
      points[id] = round2(scorer(week.stats, position))
    }
  }
  return { points, statsOnFile: anyRow != null }
}

/**
 * The Fantrax scoring period a moment falls in, from the league's stored periods
 * (`League.settings.fantrax_scoring_periods`), as `game_date` keys. Between periods, or after the
 * last, the most recent one that has started.
 */
export function currentFantraxPeriod(
  periods: unknown,
  now: Date,
): { number: number; window: { start: Date; end: Date } } | null {
  if (!Array.isArray(periods)) return null
  const parsed = periods
    .map((p) => p as { number?: unknown; startDate?: unknown; endDate?: unknown })
    .map((p) => ({ number: Number(p.number), start: Date.parse(String(p.startDate ?? '')), end: Date.parse(String(p.endDate ?? '')) }))
    .filter((p) => Number.isInteger(p.number) && Number.isFinite(p.start) && Number.isFinite(p.end))
    .sort((a, b) => a.start - b.start)
  const t = now.getTime()
  const hit = parsed.find((p) => t >= p.start && t < p.end) ?? [...parsed].reverse().find((p) => p.start <= t)
  if (!hit) return null
  const day = (ms: number) => new Date(new Date(ms).toISOString().slice(0, 10) + 'T00:00:00Z')
  // A period ends a moment before the next begins; its last day is the day before the next period's first.
  return { number: hit.number, window: { start: day(hit.start), end: day(hit.end + 1000) } }
}
