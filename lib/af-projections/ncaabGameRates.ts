import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'

/** Full regular-season appearances. The provider's season totals can cover fewer schools than its boxes. */
async function readGameRates(season: number, now: Date) {
  const rows = await prisma.playerGameStat.findMany({
    where: { sportType: 'NCAAB', season, source: 'rolling_insights_live',
      AND: [{ normalizedStatMap: { path: ['seasonType'], equals: 'regular' } }],
      OR: [
        { gameDate: { lt: new Date(now.toISOString().slice(0, 10)) } },
        { gameDate: { lte: now }, normalizedStatMap: { path: ['gameFinal'], equals: true } },
      ],
    },
    select: { playerId: true, normalizedStatMap: true, gameDate: true, team: true },
    orderBy: [{ gameDate: 'asc' }, { id: 'asc' }],
  })
  const rates = new Map<string, { games: number; stats: Record<string, number>; team: string | null }>()
  const normalize = getDailySportNormalizer('NCAAB')!
  for (const row of rows) {
    const line = row.normalizedStatMap
    if (!line || typeof line !== 'object' || Array.isArray(line) || line.gameFinal === false) continue
    const box = line.stats
    if (!box || typeof box !== 'object' || Array.isArray(box) || !(Number(box.minutes) > 0)) continue
    const { stats } = normalize(box)
    if (!Object.keys(stats).length) continue
    const player = rates.get(row.playerId) ?? { games: 0, stats: {}, team: null }
    player.games++
    if (row.team) player.team = row.team
    for (const [stat, amount] of Object.entries(stats)) player.stats[stat] = (player.stats[stat] ?? 0) + amount
    rates.set(row.playerId, player)
  }
  for (const row of rates.values()) for (const stat of Object.keys(row.stats)) row.stats[stat] /= row.games
  return rates
}

let cached: { season: number; day: string; expires: number; read: ReturnType<typeof readGameRates> } | undefined
export function loadNcaabGameRates(season: number, now: Date) {
  const day = now.toISOString().slice(0, 10)
  if (cached?.season === season && cached.day === day && cached.expires > Date.now()) return cached.read
  const read = readGameRates(season, now).catch((error) => {
    if (cached?.read === read) cached = undefined
    throw error
  })
  cached = { season, day, expires: Date.now() + 60_000, read }
  return read
}

const basketballStats = ['points', 'assists', 'blocks', 'steals', 'fouls', 'turnovers', 'minutes',
  'total_rebounds', 'defensive_rebounds', 'offensive_rebounds', 'field_goals_made', 'field_goals_attempted',
  'free_throws_made', 'free_throws_attempted', 'two_points_made', 'two_points_attempted', 'three_points_made', 'three_points_attempted']

// Aggregate completed historical boxes in Postgres. Only one rate line per
// athlete crosses the wire, even when the previous season has 100,000 boxes.
async function readPriorBoxRates(season: number) {
  const fields = basketballStats.map(key => Prisma.sql`${key}::text, AVG(CASE WHEN jsonb_typeof(box -> ${key}::text) = 'number'
    THEN (box ->> ${key}::text)::double precision ELSE 0 END)`)
  const rows = await prisma.$queryRaw<Array<{ id: string; games: number; rates: Record<string, number> }>>(Prisma.sql`
    SELECT "playerId" AS id, count(*)::int AS games, jsonb_build_object(${Prisma.join(fields)}) AS rates
    FROM player_game_stats
    CROSS JOIN LATERAL (SELECT normalized_stat_map -> 'stats' AS box) b
    WHERE "sportType"='NCAAB' AND season=${season} AND source='rolling_insights_live'
      AND normalized_stat_map ->> 'seasonType'='regular' AND jsonb_typeof(box -> 'minutes')='number'
      AND (box -> 'minutes') > '0'::jsonb
    GROUP BY "playerId" HAVING count(*) >= 10`)
  const normalize = getDailySportNormalizer('NCAAB')!
  return new Map(rows.map(row => {
    const { stats } = normalize(row.rates)
    delete stats.dbl_dbl
    delete stats.trpl_dbl
    return [row.id, { games: row.games, stats }] as const
  }))
}

let priorCache: { season: number; expires: number; read: ReturnType<typeof readPriorBoxRates> } | undefined
export function loadPriorNcaabBoxRates(season: number) {
  if (priorCache?.season === season && priorCache.expires > Date.now()) return priorCache.read
  const read = readPriorBoxRates(season).catch(error => {
    if (priorCache?.read === read) priorCache = undefined
    throw error
  })
  priorCache = { season, read, expires: Date.now() + 86_400_000 }
  return read
}
