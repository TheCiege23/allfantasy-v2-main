import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeNbaGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import type { TradeLeagueContext } from './loadTradeLeagueContext'

type History = {
  playerId: string | null
  seasons: Array<{ season: string; gamesPlayed: number | null; stats: Record<string, unknown>; source: string; fetchedAt: string }>
  gameLogs: Array<{ gameId: string; season: number; date: string | null; stats: Record<string, unknown>; source: string | null }>
}
export type NbaTradeAsset = { name: string; playerId?: string | null }

export type NbaPricedPlayer = {
  name: string
  playerId: string
  pointsPerGame: number
  currentSeason: string | null
  currentPointsPerGame: number | null
  previousPointsPerGame: number | null
  recentFivePointsPerGame: number | null
  seasonGames: number
  source: string
  sourceFetchedAt: string | null
}

export type NbaPointsTradeEvaluation =
  | { ok: true; senderGives: NbaPricedPlayer[]; receiverGives: NbaPricedPlayer[]; senderTotal: number; receiverTotal: number; coverage: string[] }
  | { ok: false; code: 'PLAYER_STATS_UNAVAILABLE' | 'PLAYER_IDENTITY_AMBIGUOUS' | 'DUPLICATE_ASSET'; players: string[] }

const STAT_ALIASES: Record<string, string[]> = {
  points: ['points', 'points_scored', 'pts'],
  rebounds: ['rebounds', 'rebound', 'total_rebounds', 'reb'],
  assists: ['assists', 'assist', 'ast'],
  steals: ['steals', 'steal', 'stl'],
  blocks: ['blocks', 'block', 'blk'],
  turnovers: ['turnovers', 'turnover', 'to', 'tov'],
  three_pointers_made: ['three_pointers_made', 'three_point_made', 'three_points_made', 'threes', '3pm', 'fg3m'],
  field_goals_made: ['field_goals_made', 'fgm'],
  field_goals_attempted: ['field_goals_attempted', 'fga'],
  free_throws_made: ['free_throws_made', 'ftm'],
  free_throws_attempted: ['free_throws_attempted', 'fta'],
  double_double: ['double_double', 'dbl_dbl', 'dd'],
  triple_double: ['triple_double', 'trpl_dbl', 'td'],
}
const KEY_TO_ALIASES = Object.fromEntries(
  Object.values(STAT_ALIASES).flatMap((aliases) => aliases.map((key) => [key, aliases])),
) as Record<string, string[]>
const GAME_BONUS_KEYS = new Set(['double_double', 'dbl_dbl', 'dd', 'triple_double', 'trpl_dbl', 'td'])

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function statValue(stats: Record<string, unknown>, key: string): number | null {
  for (const alias of KEY_TO_ALIASES[key] ?? [key]) {
    const value = numeric(stats[alias])
    if (value !== null) return value
  }
  return null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function nameKey(name: string): string {
  // Fantrax's public directory uses "Last, First" while identity rows use
  // "First Last". Keep the provider id check below as the primary constraint.
  const parts = name.split(',')
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name
  return ordered.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Resolve within the sport before reading DB snapshots; an ambiguous name is never priced. */
export async function readNbaPlayerHistory(asset: NbaTradeAsset): Promise<History> {
  const id = asset.playerId?.trim() || null
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NBA', OR: [
      { canonicalName: { equals: asset.name, mode: 'insensitive' } },
      ...(id ? [{ id }, { sleeperId: id }, { rollingInsightsId: id }, { espnId: id }, { fantraxId: id }] : []),
    ] },
    select: { id: true, canonicalName: true, sleeperId: true, rollingInsightsId: true, espnId: true, fantraxId: true },
  })
  const named = identities.filter((row) => nameKey(row.canonicalName) === nameKey(asset.name))
  const exact = id ? named.filter((row) => [row.id, row.sleeperId, row.rollingInsightsId, row.espnId, row.fantraxId].includes(id)) : []
  const candidates = id ? exact : named
  if (candidates.length > 1) throw new Error('PLAYER_HISTORY_IDENTITY_AMBIGUOUS')
  const identity = candidates[0]
  if (!identity) return { playerId: null, seasons: [], gameLogs: [] }
  const ids = [...new Set([identity.id, identity.sleeperId, identity.rollingInsightsId, identity.espnId, identity.fantraxId]
    .filter((value): value is string => Boolean(value)))]
  const [seasonRows, gameRows] = await Promise.all([
    prisma.playerSeasonStats.findMany({
      where: { sport: 'NBA', seasonType: 'regular', playerId: { in: ids } },
      orderBy: [{ season: 'desc' }, { fetchedAt: 'desc' }], take: 8,
      select: { season: true, gamesPlayed: true, stats: true, source: true, fetchedAt: true },
    }),
    prisma.playerGameStat.findMany({
      where: { sportType: 'NBA', playerId: { in: ids } },
      orderBy: [{ gameDate: 'desc' }, { updatedAt: 'desc' }], take: 400,
      select: { gameId: true, season: true, gameDate: true, normalizedStatMap: true, source: true },
    }),
  ])
  const seasons = new Map<string, History['seasons'][number]>()
  for (const row of seasonRows) if (!seasons.has(row.season)) seasons.set(row.season, {
    season: row.season, gamesPlayed: row.gamesPlayed, stats: record(row.stats), source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
  })
  const seenGames = new Set<string>()
  const gameLogs = gameRows.flatMap((row): History['gameLogs'] => {
    if (seenGames.has(row.gameId)) return []
    seenGames.add(row.gameId)
    return [{ gameId: row.gameId, season: row.season,
      date: row.gameDate?.toISOString().slice(0, 10) ?? null,
      stats: record(row.normalizedStatMap), source: row.source }]
  })
  return { playerId: identity.id, seasons: [...seasons.values()], gameLogs }
}

/** Apply exactly the saved points rules; zero is a valid rule and missing stats are not zero evidence. */
export function scoreNbaStats(stats: Record<string, unknown>, rules: Record<string, number>): number | null {
  let total = 0
  let matched = 0
  for (const [key, weight] of Object.entries(rules)) {
    if (!Number.isFinite(weight) || weight === 0) continue
    const value = statValue(stats, key)
    if (value === null) continue
    total += value * weight
    matched++
  }
  return matched ? Math.round(total * 100) / 100 : null
}

function seasonRate(row: History['seasons'][number], games: History['gameLogs'], rules: Record<string, number>): number | null {
  if (!row.gamesPlayed || row.gamesPlayed < 1) return null
  if (statValue(row.stats, 'points') === null) return null
  // A custom scored stat absent from the provider snapshot is unknown, not zero.
  if (Object.entries(rules).some(([key, weight]) =>
    weight !== 0 && !GAME_BONUS_KEYS.has(key) && statValue(row.stats, key) === null)) return null
  const missingGameBonus = Object.entries(rules).some(([key, weight]) =>
    GAME_BONUS_KEYS.has(key) && weight !== 0 && statValue(row.stats, key) === null)
  if (missingGameBonus) {
    const seasonGames = games.filter((game) => row.season.includes(String(game.season)))
    if (seasonGames.length < row.gamesPlayed) return null
    const scores = seasonGames.map((game) => scoreNbaStats(
      normalizeNbaGameStats(game.stats).stats, rules))
    if (scores.some((score) => score === null)) return null
    return Math.round(scores.reduce<number>((sum, score) => sum + score!, 0) / seasonGames.length * 100) / 100
  }
  const total = scoreNbaStats(row.stats, rules)
  return total === null ? null : Math.round(total / row.gamesPlayed * 100) / 100
}

export function priceNbaHistory(name: string, history: History, rules: Record<string, number>): NbaPricedPlayer | null {
  const latest = history.seasons[0]
  const latestRate = latest ? seasonRate(latest, history.gameLogs, rules) : null
  if (latest && latestRate === null) return null
  const current = latest && latestRate !== null ? { row: latest, rate: latestRate } : null
  const prior = history.seasons.slice(1)
    .map((row) => ({ row, rate: seasonRate(row, history.gameLogs, rules) }))
    .find((entry) => entry.rate !== null)
  const previous = prior && prior.rate !== null ? { row: prior.row, rate: prior.rate } : null
  const games = history.gameLogs
    .filter((row) => row.date && row.stats && typeof row.stats === 'object')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const recentScores = games.slice(0, 5).map((row) => scoreNbaStats(normalizeNbaGameStats(row.stats).stats, rules))
    .filter((score): score is number => score !== null)
  const recentFivePointsPerGame = recentScores.length >= 3
    ? Math.round(recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length * 100) / 100
    : null
  // Historical production is a measured signal, not a calibrated market or playoff forecast.
  // Current season gets 70% weight when a previous season is also available.
  const pointsPerGame = current && previous
    ? Math.round((current.rate * 0.7 + previous.rate * 0.3) * 100) / 100
    : current?.rate
  if (pointsPerGame === null || pointsPerGame === undefined || !history.playerId) return null
  return {
    name, playerId: history.playerId, pointsPerGame,
    currentSeason: current?.row.season ?? null,
    currentPointsPerGame: current?.rate ?? null,
    previousPointsPerGame: previous?.rate ?? null,
    recentFivePointsPerGame,
    seasonGames: current?.row.gamesPlayed ?? 0,
    source: current?.row.source ?? games[0]?.source ?? 'unknown',
    sourceFetchedAt: current?.row.fetchedAt ?? null,
  }
}

/** DB-only NBA points comparison for an authorized two-team league. */
export async function loadNbaPointsTradeEvaluation(args: {
  league: TradeLeagueContext
  senderGives: NbaTradeAsset[]
  receiverGives: NbaTradeAsset[]
}): Promise<NbaPointsTradeEvaluation> {
  const assets = [...args.senderGives, ...args.receiverGives]
  const priced = await Promise.all(assets.map(async (asset) => {
    try {
      const history = await readNbaPlayerHistory(asset)
      return { asset, player: priceNbaHistory(asset.name, history, args.league.scoringRules), ambiguous: false }
    } catch (error) {
      return { asset, player: null, ambiguous: (error as Error).message === 'PLAYER_HISTORY_IDENTITY_AMBIGUOUS' }
    }
  }))
  const ambiguous = priced.filter((entry) => entry.ambiguous).map((entry) => entry.asset.name)
  if (ambiguous.length) return { ok: false, code: 'PLAYER_IDENTITY_AMBIGUOUS', players: ambiguous }
  const missing = priced.filter((entry) => !entry.player).map((entry) => entry.asset.name)
  if (missing.length) return { ok: false, code: 'PLAYER_STATS_UNAVAILABLE', players: missing }
  const players = priced.map((entry) => entry.player!)
  if (new Set(players.map((player) => player.playerId)).size !== players.length) {
    return { ok: false, code: 'DUPLICATE_ASSET', players: players.map((player) => player.name) }
  }
  const senderGives = players.slice(0, args.senderGives.length)
  const receiverGives = players.slice(args.senderGives.length)
  const total = (rows: NbaPricedPlayer[]) => Math.round(rows.reduce((sum, row) => sum + row.pointsPerGame, 0) * 100) / 100
  return {
    ok: true, senderGives, receiverGives,
    senderTotal: total(senderGives), receiverTotal: total(receiverGives),
    coverage: players.flatMap((player) => [
      ...(player.previousPointsPerGame === null ? [`${player.name}: previous season unavailable`] : []),
      ...(player.recentFivePointsPerGame === null ? [`${player.name}: recent game sample unavailable`] : []),
    ]),
  }
}
