import 'server-only'

import { prisma } from '@/lib/prisma'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'

/**
 * sleeperMarketService — projections + market ADP over the RotoWire feed that
 * Sleeper serves publicly (api.sleeper.com/projections).
 *
 * Two boards, both cached in SportsDataCache (no migrations):
 *  - WEEK board: per-player projected stat lines for one week → used to score
 *    lineups with a league's REAL scoring_settings (dot product), falling back
 *    to the feed's own pts_{format} when a stat-line score isn't computable.
 *  - SEASON board: per-player ADP across every format column the feed carries
 *    (adp_idp, adp_idp_1qb, adp_rookie, adp_dynasty_*, adp_2qb, adp_ppr, …)
 *    plus years_exp for rookie detection. 999 in the feed means "not ranked in
 *    this format" and is normalized to null — never displayed as a number.
 *
 * Data source is labeled wherever surfaced: market ADP is RotoWire's, not an
 * AF valuation.
 */

const PROJ = 'https://api.sleeper.com/projections/nfl'
const STATS = 'https://api.sleeper.com/stats/nfl'
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'] as const
const WEEK_PREFIX = 'projections:week:v1:'
const SEASON_PREFIX = 'projections:season:v1:'
const STATS_PREFIX = 'stats:season:v1:'
const WEEK_STATS_PREFIX = 'stats:week:v1:'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const COMPLETED_SEASON_TTL_MS = 30 * 24 * 60 * 60 * 1000 // finished seasons don't change

type WireRow = {
  player_id: string
  player?: {
    first_name?: string | null
    last_name?: string | null
    position?: string | null
    team?: string | null
    years_exp?: number | null
  } | null
  stats?: Record<string, number> | null
}

function positionQuery(): string {
  return POSITIONS.map((p) => `position[]=${p}`).join('&')
}

async function fetchRows(url: string): Promise<WireRow[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? (data as WireRow[]) : null
  } catch {
    return null
  }
}

async function cachedBoard<T extends { version: 1 }>(
  cacheKey: string,
  build: () => Promise<T | null>,
  ttlMs: number = CACHE_TTL_MS,
): Promise<T | null> {
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const payload =
    cached && cached.data && typeof cached.data === 'object' ? (cached.data as unknown as T) : null
  if (payload?.version === 1 && cached && cached.expiresAt > now) return payload

  const fresh = await build()
  if (fresh) {
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + ttlMs) },
        create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + ttlMs) },
      })
      .catch((err) => console.error('[sleeper-market] cache write failed', { cacheKey, err }))
    return fresh
  }
  return payload?.version === 1 ? payload : null
}

// ── Week board ───────────────────────────────────────────────────────────────
export type WeekProjectionRow = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  stats: Record<string, number>
}
export type WeekBoard = {
  version: 1
  season: string
  week: number
  players: Record<string, WeekProjectionRow>
}

export async function getWeekBoard(season: string, week: number): Promise<WeekBoard | null> {
  return cachedBoard<WeekBoard>(`${WEEK_PREFIX}${season}:${week}`, async () => {
    const rows = await fetchRows(`${PROJ}/${season}/${week}?season_type=regular&${positionQuery()}`)
    if (!rows) return null
    const players: Record<string, WeekProjectionRow> = {}
    for (const r of rows) {
      if (!r.player_id) continue
      players[r.player_id] = {
        playerId: r.player_id,
        name:
          [r.player?.first_name, r.player?.last_name].filter(Boolean).join(' ').trim() || r.player_id,
        position: r.player?.position?.toUpperCase() ?? null,
        team: r.player?.team ?? null,
        stats: r.stats ?? {},
      }
    }
    return { version: 1, season, week, players }
  })
}

/**
 * Sleeper uses TWO scoring vocabularies for the same IDP stats, and a league may be on
 * either. The projections feed always emits the `idp_`-prefixed form, so a league whose
 * `scoring_settings` use the bare form matched NOTHING and fell through to `pts_ppr`.
 *
 * Measured on the same Jonathan Greenard (DE) projection row:
 *   "NFC Dreaming!"      idp_tkl_solo vocabulary -> 11.01 pts, mode=league-scored
 *   "Versuz on Sleeper!" tkl_solo     vocabulary ->  0.78 pts, mode=format-approx
 * 0.78 is his offensive-only `pts_ppr`. Defenders were being understated ~14x in every
 * league on the bare vocabulary — across projected standings, draft report, trade grade
 * and matchup center.
 *
 * SCOPE IS DELIBERATELY NARROW. Only keys that are unambiguously individual-defense are
 * aliased. `sack`, `int`, `ff`, `fum_rec`, `safe`, `blk_kick` and `def_td` are ALSO the
 * TEAM-DEFENSE (DEF unit) settings that every Sleeper league carries by default — measured
 * across 57 of Guap's leagues, 45 score exactly `sack, int, ff, fum_rec` and nothing else
 * defensive. Aliasing those would apply a DEF-unit weight to an individual player and
 * manufacture points for defenders in leagues that do not roster them. That would be a new
 * bug, not a fix.
 *
 * Tackles, tackles-for-loss, QB hits and passes-defended have no team-defense equivalent, so
 * they are safe to bridge.
 *
 * ALSO NOT ALIASED: `st_tkl_solo` / `def_st_tkl_solo` are SPECIAL-TEAMS tackles, a different
 * stat leagues score separately. Folding them in would count coverage-team work as defensive
 * production.
 *
 * Practical effect on the current league set is small — 8 leagues already use the prefixed
 * vocabulary and the rest set their bare tackle values to 0 — but a league that scores bare
 * `tkl_solo` with real values was silently getting `pts_ppr` for every defender, and now is not.
 */
const IDP_KEY_ALIASES: Record<string, string> = {
  idp_tkl: 'tkl',
  idp_tkl_solo: 'tkl_solo',
  idp_tkl_ast: 'tkl_ast',
  idp_tkl_loss: 'tkl_loss',
  idp_pass_def: 'pass_def',
  idp_qb_hit: 'qb_hit',
}

/**
 * Weight for one stat key, trying the league's exact key first and the documented alias
 * second. Exact always wins, so a league carrying both keys is scored on its own explicit
 * setting rather than on our alias table.
 */
function resolveScoringWeight(scoring: Record<string, number>, statKey: string): number | undefined {
  const exact = scoring[statKey]
  if (typeof exact === 'number') return exact
  const alias = IDP_KEY_ALIASES[statKey]
  return alias ? scoring[alias] : undefined
}

/**
 * Score one projected stat line with the league's real scoring settings.
 * Dot product over shared stat keys (the pts_ and adp_ columns are excluded —
 * those are the feed's own aggregates, not stats). Falls back to pts_{format}
 * when the dot product finds no scorable overlap, and says which mode it used.
 */
export function scoreStatLine(
  stats: Record<string, number>,
  scoring: Record<string, number>,
  format: 'ppr' | 'half_ppr' | 'std',
): { points: number; mode: 'league-scored' | 'format-approx' } {
  let points = 0
  let matched = 0
  for (const [key, value] of Object.entries(stats)) {
    if (key.startsWith('pts_') || key.startsWith('adp_') || key === 'gp') continue
    const weight = resolveScoringWeight(scoring, key)
    if (typeof weight === 'number' && weight !== 0 && typeof value === 'number') {
      points += value * weight
      matched += 1
    }
  }
  if (matched > 0) return { points, mode: 'league-scored' }
  const fallback = stats[`pts_${format}`] ?? stats.pts_ppr ?? 0
  return { points: fallback, mode: 'format-approx' }
}

// ── Season / ADP board ───────────────────────────────────────────────────────
export type MarketPlayer = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  yearsExp: number | null
  /** 999 (feed's "unranked") normalized to null. */
  adp: Record<string, number | null>
}
export type SeasonBoard = {
  version: 1
  season: string
  players: Record<string, MarketPlayer>
}

const ADP_KEYS = [
  'adp_std', 'adp_half_ppr', 'adp_ppr', 'adp_2qb',
  'adp_dynasty', 'adp_dynasty_std', 'adp_dynasty_half_ppr', 'adp_dynasty_ppr', 'adp_dynasty_2qb',
  'adp_idp', 'adp_idp_1qb', 'adp_rookie',
] as const

export async function getSeasonBoard(season: string): Promise<SeasonBoard | null> {
  return cachedBoard<SeasonBoard>(`${SEASON_PREFIX}${season}`, async () => {
    const rows = await fetchRows(`${PROJ}/${season}?season_type=regular&${positionQuery()}`)
    if (!rows) return null
    const players: Record<string, MarketPlayer> = {}
    for (const r of rows) {
      if (!r.player_id) continue
      const adp: Record<string, number | null> = {}
      for (const key of ADP_KEYS) {
        const v = r.stats?.[key]
        adp[key] = typeof v === 'number' && v > 0 && v < 999 ? v : null
      }
      players[r.player_id] = {
        playerId: r.player_id,
        name:
          [r.player?.first_name, r.player?.last_name].filter(Boolean).join(' ').trim() || r.player_id,
        position: r.player?.position?.toUpperCase() ?? null,
        team: r.player?.team ?? null,
        yearsExp: r.player?.years_exp ?? null,
        adp,
      }
    }
    return { version: 1, season, players }
  })
}

// ── Season STATS board (actuals, not projections — for retro trade grading) ──
export type SeasonStatRow = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  /** Raw + aggregate season stats, incl. gp (games played) and pts_{format}. */
  stats: Record<string, number>
}
export type SeasonStatsBoard = {
  version: 1
  season: string
  players: Record<string, SeasonStatRow>
}

/**
 * Actual season totals from api.sleeper.com/stats. Completed seasons cache for
 * 30 days (they don't change); in-progress seasons for 6h.
 */
export async function getSeasonStatsBoard(
  season: string,
  completed: boolean,
): Promise<SeasonStatsBoard | null> {
  return cachedBoard<SeasonStatsBoard>(
    `${STATS_PREFIX}${season}`,
    async () => {
      const rows = await fetchRows(`${STATS}/${season}?season_type=regular&${positionQuery()}`)
      if (!rows) return null
      const players: Record<string, SeasonStatRow> = {}
      for (const r of rows) {
        if (!r.player_id) continue
        players[r.player_id] = {
          playerId: r.player_id,
          name:
            [r.player?.first_name, r.player?.last_name].filter(Boolean).join(' ').trim() ||
            r.player_id,
          position: r.player?.position?.toUpperCase() ?? null,
          team: r.player?.team ?? null,
          stats: r.stats ?? {},
        }
      }
      return { version: 1, season, players }
    },
    completed ? COMPLETED_SEASON_TTL_MS : CACHE_TTL_MS,
  )
}

/**
 * Actual WEEKLY stat lines — used by tenure-aware trade grading to credit only
 * the weeks an asset was actually on the roster. Same shape as the season
 * board (season field keeps the year; the week lives in the cache key).
 */
export async function getWeekStatsBoard(
  season: string,
  week: number,
  completed: boolean,
): Promise<SeasonStatsBoard | null> {
  return cachedBoard<SeasonStatsBoard>(
    `${WEEK_STATS_PREFIX}${season}:${week}`,
    async () => {
      const rows = await fetchRows(`${STATS}/${season}/${week}?season_type=regular&${positionQuery()}`)
      if (!rows) return null
      const players: Record<string, SeasonStatRow> = {}
      for (const r of rows) {
        if (!r.player_id) continue
        players[r.player_id] = {
          playerId: r.player_id,
          name:
            [r.player?.first_name, r.player?.last_name].filter(Boolean).join(' ').trim() ||
            r.player_id,
          position: r.player?.position?.toUpperCase() ?? null,
          team: r.player?.team ?? null,
          stats: r.stats ?? {},
        }
      }
      return { version: 1, season, players }
    },
    completed ? COMPLETED_SEASON_TTL_MS : CACHE_TTL_MS,
  )
}

/** ADP for one player in the league's own format (context.adpKey), rookie-aware. */
export function adpFor(player: MarketPlayer, context: Pick<LeagueContextEnvelope, 'adpKey'>): number | null {
  return player.adp[context.adpKey] ?? null
}

export function isRookie(player: MarketPlayer): boolean {
  return player.yearsExp === 0
}

const IDP_POSITIONS = new Set(['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'])
export function isIdp(player: MarketPlayer): boolean {
  return Boolean(player.position && IDP_POSITIONS.has(player.position))
}
