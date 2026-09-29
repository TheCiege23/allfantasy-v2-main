/**
 * Cross-sport player valuation feature layer — DB-first, AI-consumable.
 *
 * Design:
 *  - One SportsDataCache entry per sport: key = `player-valuations:{sport}`
 *  - Valuation is computed from Rolling Insights raw stats + injuries + ADP
 *  - Output is a normalized 0–10 000 value scale (matches FantasyCalc convention)
 *  - All consumers (AI, UI) read only from DB; `lib/player-valuation-sync.ts` populates the cache,
 *    daily from `/api/cron/adp-refresh` and on demand via `npm run sync:player-valuations`
 */

import { prisma } from '@/lib/prisma'
import type { ApiChainSport } from '@/lib/workers/api-config'

export const VALUATION_KEY_PREFIX = 'player-valuations:'
export const VALUATION_VERSION = '1.0'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Normalized per-player valuation fed to the AI and UI layers. */
export type PlayerValuation = {
  playerId: string
  name: string
  sport: ApiChainSport
  position: string
  team: string
  /** Fantasy value 0–10 000 (production × health × form blend). */
  value: number
  /** Tier bucket: S → elite, A → starter, B → solid, C → fringe, D → deep cut. */
  tier: 'S' | 'A' | 'B' | 'C' | 'D'
  /** Directional trend relative to recent-form score. */
  trend: 'up' | 'flat' | 'down'
  /** 0–100: role/volume signal (inverted ADP or depth-chart signal). */
  opportunityScore: number
  /** 0–100: injury/health signal (100 = fully healthy, 0 = out/IR). */
  healthScore: number
  /** 0–100: recent-form vs season-average comparison. */
  recentFormScore: number
  adp: number | null
  /** Raw stats blob passed through for AI prompt context. */
  rawStats: Record<string, unknown>
  valuationVersion: string
  syncedAt: string
}

type CachedValuationPayload = {
  players: PlayerValuation[]
  sport: ApiChainSport
  syncedAt: string
}

// ─── Stat weight maps ─────────────────────────────────────────────────────────
//  Keys are lowercase field names as returned by Rolling Insights.
//  Positive weight = scoring/value contribution.
//  Negative weight = penalty (turnovers, ERA, etc.).
//  These are tunable; the framework handles missing fields gracefully.

const STAT_WEIGHTS: Partial<Record<ApiChainSport, Record<string, Record<string, number>>>> = {
  nfl: {
    QB: {
      passing_yards: 1, passing_touchdowns: 6, passing_tds: 6,
      rushing_yards: 1, rushing_touchdowns: 6, rushing_tds: 6,
      interceptions: -4, fumbles: -4, completions: 0.1,
    },
    RB: {
      rushing_yards: 1, rushing_touchdowns: 6, rushing_tds: 6,
      receiving_yards: 1, receiving_touchdowns: 6, receiving_tds: 6,
      receptions: 1, targets: 0.5,
    },
    WR: {
      receiving_yards: 1, receiving_touchdowns: 6, receiving_tds: 6,
      receptions: 1, targets: 0.5,
    },
    TE: {
      receiving_yards: 1, receiving_touchdowns: 6, receiving_tds: 6,
      receptions: 1, targets: 0.5,
    },
    DL: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 2.5, tfl: 2.5,
      sacks: 8,
      qb_hits: 1.5,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 6,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    DE: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 2.5, tfl: 2.5,
      sacks: 8,
      qb_hits: 1.5,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 6,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    DT: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 2.5, tfl: 2.5,
      sacks: 8,
      qb_hits: 1.5,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 6,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    EDGE: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 2.5, tfl: 2.5,
      sacks: 8,
      qb_hits: 1.5,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 6,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    LB: {
      tackles: 2, total_tackles: 2,
      solo_tackles: 2.5, assisted_tackles: 1,
      tackles_for_loss: 2, tfl: 2,
      sacks: 7,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 7,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    ILB: {
      tackles: 2, total_tackles: 2,
      solo_tackles: 2.5, assisted_tackles: 1,
      tackles_for_loss: 2, tfl: 2,
      sacks: 7,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 7,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    OLB: {
      tackles: 2, total_tackles: 2,
      solo_tackles: 2.5, assisted_tackles: 1,
      tackles_for_loss: 2, tfl: 2,
      sacks: 7,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 2,
      interceptions: 7,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    DB: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 1.5, tfl: 1.5,
      sacks: 6,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 3,
      interceptions: 8,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    CB: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 1.5, tfl: 1.5,
      sacks: 6,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 3,
      interceptions: 8,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    S: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 1.5, tfl: 1.5,
      sacks: 6,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 3,
      interceptions: 8,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    SS: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 1.5, tfl: 1.5,
      sacks: 6,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 3,
      interceptions: 8,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    FS: {
      tackles: 1.5, total_tackles: 1.5,
      solo_tackles: 2, assisted_tackles: 1,
      tackles_for_loss: 1.5, tfl: 1.5,
      sacks: 6,
      qb_hits: 1,
      forced_fumbles: 4,
      fumbles_recovered: 4,
      passes_defended: 3,
      interceptions: 8,
      defensive_touchdowns: 6, defensive_tds: 6,
      safeties: 6,
    },
    K: { field_goals_made: 3, fg_made: 3, extra_points_made: 1, pat_made: 1 },
    DEFAULT: { rushing_yards: 1, receiving_yards: 1, rushing_tds: 6, receiving_tds: 6 },
  },
  nba: {
    DEFAULT: {
      points: 1.5, pts: 1.5,
      rebounds: 1.2, reb: 1.2, offensive_rebounds: 0.8, oreb: 0.8,
      assists: 2, ast: 2,
      steals: 3, stl: 3,
      blocks: 3, blk: 3,
      turnovers: -1.5, tov: -1.5,
      three_pointers_made: 1, three_pm: 1,
    },
  },
  mlb: {
    SP: {
      strikeouts: 2, wins: 5, innings_pitched: 0.5,
      // ERA/WHIP: lower is better — store as negative multipliers
      era: -3, whip: -8,
      complete_games: 3,
    },
    RP: { saves: 5, holds: 3, strikeouts: 1.5, era: -2, whip: -5, blown_saves: -3 },
    DEFAULT: {
      batting_average: 350, avg: 350,
      home_runs: 8, hr: 8,
      rbi: 2, runs: 1.5,
      stolen_bases: 5, sb: 5,
      hits: 0.5, walks: 0.3,
      on_base_percentage: 200, obp: 200,
    },
  },
  nhl: {
    G: {
      wins: 5, saves: 0.2, save_percentage: 150,
      shutouts: 8, goals_against_average: -6,
    },
    DEFAULT: {
      goals: 8, assists: 5, points: 2,
      plus_minus: 1, shots: 0.2,
      power_play_goals: 3, power_play_points: 2,
      short_handed_goals: 5,
    },
  },
  ncaaf: {
    QB: {
      passing_yards: 1, passing_touchdowns: 6, passing_tds: 6,
      rushing_yards: 1, rushing_touchdowns: 6, rushing_tds: 6,
      interceptions: -4,
    },
    RB: {
      rushing_yards: 1, rushing_touchdowns: 6, rushing_tds: 6,
      receiving_yards: 1, receptions: 1,
    },
    WR: { receiving_yards: 1, receiving_touchdowns: 6, receiving_tds: 6, receptions: 1 },
    DEFAULT: { rushing_yards: 1, receiving_yards: 1, rushing_tds: 6, receiving_tds: 6 },
  },
  ncaab: {
    DEFAULT: {
      points: 1.5, pts: 1.5,
      rebounds: 1.2, reb: 1.2,
      assists: 2, ast: 2,
      steals: 3, stl: 3,
      blocks: 3, blk: 3,
    },
  },
  soccer_euro: {
    GK: {
      clean_sheets: 10, saves: 0.5,
      goals_conceded: -1, penalties_saved: 6,
    },
    DEFAULT: {
      goals: 12, assists: 8,
      key_passes: 2, shots_on_target: 1,
      dribbles_completed: 0.5, dribbles_succeeded: 0.5,
      clean_sheets: 4,  // defenders also get clean sheet credit
      tackles_won: 0.5, interceptions: 0.5,
    },
  },
}

/** Per-sport divisor to scale raw stat totals into the 0–10 000 range. */
const SPORT_DIVISORS: Record<ApiChainSport, number> = {
  nfl: 3,
  nba: 1.5,
  mlb: 1.5,
  nhl: 2.5,
  ncaaf: 3,
  ncaab: 1.5,
  soccer_euro: 1.5,
  soccer_mls: 1.5,
}

function getWeights(sport: ApiChainSport, position: string): Record<string, number> {
  const wSport: ApiChainSport = sport === 'soccer_mls' ? 'soccer_euro' : sport
  const sportWeights = STAT_WEIGHTS[wSport] ?? {}
  const pos = position?.toUpperCase() ?? 'DEFAULT'
  return sportWeights[pos] ?? sportWeights['DEFAULT'] ?? {}
}

function statScore(stats: Record<string, unknown>, weights: Record<string, number>): number {
  let total = 0
  for (const [key, weight] of Object.entries(weights)) {
    const raw = stats[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      total += raw * weight
    }
  }
  return Math.max(0, total)
}

/** Injury/health status → 0–100 score. */
const INJURY_STATUS_HEALTH: Record<string, number> = {
  active: 100, healthy: 100, full: 100,
  probable: 90,
  questionable: 60,
  doubtful: 25,
  out: 0, inactive: 0,
  ir: 0, injured_reserve: 0,
  pup: 0, nfi: 0,
  suspended: 0,
}

function healthScore(status: string | null | undefined): number {
  if (!status) return 100
  return INJURY_STATUS_HEALTH[status.toLowerCase()] ?? 80
}

/** Map ADP (1–300) to a 0–100 opportunity signal where lower ADP → higher score. */
function opportunityScore(adp: number | null | undefined): number {
  if (adp == null || adp <= 0) return 50
  return Math.max(0, Math.min(100, Math.round((1 - (adp - 1) / 299) * 100)))
}

const NFL_IDP_POSITIONS = new Set(['DL', 'DE', 'DT', 'EDGE', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'SS', 'FS'])

function deriveIdpOpportunityFromProduction(
  sport: ApiChainSport,
  position: string,
  normalizedBase: number,
  adp: number | null | undefined
): number | null {
  if (sport !== 'nfl') return null
  if (adp != null && adp > 0) return null
  const pos = position.toUpperCase()
  if (!NFL_IDP_POSITIONS.has(pos)) return null

  // Temporary fallback while upstream ADP endpoint is unavailable for IDP.
  return Math.max(35, Math.min(85, Math.round(35 + normalizedBase / 5)))
}

function assignTier(value: number): PlayerValuation['tier'] {
  if (value >= 8000) return 'S'
  if (value >= 6000) return 'A'
  if (value >= 4000) return 'B'
  if (value >= 2000) return 'C'
  return 'D'
}

// ─── Core public compute function ─────────────────────────────────────────────

export interface ComputeValuationInput {
  playerId: string
  name: string
  sport: ApiChainSport
  position: string
  team: string
  stats: Record<string, unknown>
  injuryStatus?: string | null
  adp?: number | null
  /** Optional: last N-week stats to compute a directional trend signal. */
  recentStats?: Record<string, unknown>
  syncedAt: string
}

export function computePlayerValuation(input: ComputeValuationInput): PlayerValuation {
  const { playerId, name, sport, position, team, stats, injuryStatus, adp, recentStats, syncedAt } = input

  const weights = getWeights(sport, position)
  const seasonScore = statScore(stats, weights)
  const divisor = SPORT_DIVISORS[sport] ?? 2
  const normalizedBase = Math.min(10000, Math.round(seasonScore / divisor))

  const health = healthScore(injuryStatus)
  const derivedIdpOpportunity = deriveIdpOpportunityFromProduction(sport, position, normalizedBase, adp)
  const opportunity = derivedIdpOpportunity ?? opportunityScore(adp)

  // Recent-form vs per-game season average (assume ~17 games/matches for normalization)
  let recentFormScore = 50
  if (recentStats && seasonScore > 0) {
    const recentRaw = statScore(recentStats, weights)
    const perGameAvg = seasonScore / 17
    if (perGameAvg > 0) {
      recentFormScore = Math.min(100, Math.max(0, Math.round((recentRaw / perGameAvg) * 50)))
    }
  }

  const trend: PlayerValuation['trend'] =
    recentFormScore >= 60 ? 'up' : recentFormScore <= 40 ? 'down' : 'flat'

  // Blend: production 70% × health multiplier, opportunity 20%, form 10%
  const healthMult = health / 100
  const value = Math.round(
    normalizedBase * healthMult * (0.7 + 0.1 * (recentFormScore / 100) + 0.2 * (opportunity / 100))
  )

  return {
    playerId,
    name,
    sport,
    position,
    team,
    value: Math.min(10000, Math.max(0, value)),
    tier: assignTier(value),
    trend,
    opportunityScore: opportunity,
    healthScore: health,
    recentFormScore,
    adp: adp ?? null,
    rawStats: stats,
    valuationVersion: VALUATION_VERSION,
    syncedAt,
  }
}

// ─── DB cache helpers (mirrors fantasycalc-db.ts pattern) ────────────────────

export function buildValuationCacheKey(sport: ApiChainSport): string {
  return `${VALUATION_KEY_PREFIX}${sport}`
}

function parseCachedPayload(data: unknown): CachedValuationPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Partial<CachedValuationPayload>
  if (!Array.isArray(d.players)) return null
  if (typeof d.sport !== 'string') return null
  if (typeof d.syncedAt !== 'string') return null
  return d as CachedValuationPayload
}

/** Write a full sport batch to SportsDataCache. Default TTL = 6 h. */
export async function writePlayerValuationsToDb(
  sport: ApiChainSport,
  players: PlayerValuation[],
  options?: { ttlMs?: number; syncedAt?: Date }
): Promise<{ cacheKey: string; expiresAt: Date; count: number }> {
  const now = new Date()
  const ttlMs = options?.ttlMs ?? 1000 * 60 * 60 * 6
  const syncedAt = options?.syncedAt ?? now
  const expiresAt = new Date(now.getTime() + ttlMs)
  const cacheKey = buildValuationCacheKey(sport)

  const payload: CachedValuationPayload = {
    players,
    sport,
    syncedAt: syncedAt.toISOString(),
  }

  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: { data: payload, expiresAt },
    create: { cacheKey, data: payload, expiresAt },
  })

  return { cacheKey, expiresAt, count: players.length }
}

/** Read a sport's valuation batch from DB. Returns stale data by default. */
export async function readPlayerValuationsFromDb(
  sport: ApiChainSport,
  options?: {
    allowStale?: boolean
    position?: string
    limit?: number
    sortBy?: 'value' | 'adp'
  }
): Promise<{
  players: PlayerValuation[]
  stale: boolean
  syncedAt: string | null
  expiresAt: string | null
}> {
  const { allowStale = true, position, limit, sortBy = 'value' } = options ?? {}
  const cacheKey = buildValuationCacheKey(sport)
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })

  if (!row) return { players: [], stale: false, syncedAt: null, expiresAt: null }

  const parsed = parseCachedPayload(row.data)
  if (!parsed) return { players: [], stale: false, syncedAt: null, expiresAt: row.expiresAt.toISOString() }

  const stale = row.expiresAt.getTime() <= Date.now()
  if (stale && !allowStale) {
    return { players: [], stale: true, syncedAt: parsed.syncedAt, expiresAt: row.expiresAt.toISOString() }
  }

  let players = parsed.players
  if (position) {
    const pos = position.toUpperCase()
    players = players.filter((p) => p.position?.toUpperCase() === pos)
  }
  if (sortBy === 'adp') {
    players = [...players].sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))
  } else {
    players = [...players].sort((a, b) => b.value - a.value)
  }
  if (limit && limit > 0) players = players.slice(0, limit)

  return { players, stale, syncedAt: parsed.syncedAt, expiresAt: row.expiresAt.toISOString() }
}

/** Health summary across all 7 sport keys. */
export async function getValuationCacheHealth(): Promise<{
  totalKeys: number
  freshKeys: number
  perSport: Record<string, { fresh: boolean; playerCount: number; syncedAt: string | null }>
}> {
  const now = new Date()
  const sports: ApiChainSport[] = ['nfl', 'nba', 'mlb', 'nhl', 'ncaaf', 'ncaab', 'soccer_euro', 'soccer_mls']

  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: VALUATION_KEY_PREFIX } },
  })

  const byKey = new Map(rows.map((r) => [r.cacheKey, r]))

  let freshKeys = 0
  const perSport: Record<string, { fresh: boolean; playerCount: number; syncedAt: string | null }> = {}

  for (const sport of sports) {
    const key = buildValuationCacheKey(sport)
    const row = byKey.get(key)
    if (!row) {
      perSport[sport] = { fresh: false, playerCount: 0, syncedAt: null }
      continue
    }
    const fresh = row.expiresAt.getTime() > now.getTime()
    if (fresh) freshKeys++
    const parsed = parseCachedPayload(row.data)
    perSport[sport] = {
      fresh,
      playerCount: parsed?.players.length ?? 0,
      syncedAt: parsed?.syncedAt ?? null,
    }
  }

  return { totalKeys: rows.length, freshKeys, perSport }
}
