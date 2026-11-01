import { MLB_PITCHING_STAT_KEYS } from '@/lib/scoring-runtime/mlbStatNormalization'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { normalizeToken } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

/**
 * GAMES LIMITS — phase D of docs/DAILY_LINEUPS_DESIGN.md. Three optional commissioner rules, all OFF
 * unless `League.settings.games_limits` names them:
 *
 *   1. Games-played caps (NBA / NHL / MLB): a season maximum of games per lineup slot, entered PER SEAT
 *      (82 for a PG seat) and multiplied by the league's seat count for that slot (two G seats → 164).
 *   2. Goalie minimum (NHL): a weekly minimum of goalie games from starting goalies.
 *   3. Innings limits (MLB): a weekly minimum and/or maximum of innings pitched by starting pitchers.
 *
 * Rules chosen (no repo doc describes ESPN's behaviour; these follow ESPN's published practice):
 *   - THE DAY THAT REACHES A LIMIT COUNTS IN FULL. A slot or the innings total is checked at the START
 *     of each Eastern day: if it is already at or past the limit, that day scores 0 for it; otherwise
 *     every game that day counts, even the ones that carry it past the limit. A doubleheader is one day.
 *   - A minimum that is not met voids the week's goalie / pitching contribution: goalie stats score 0;
 *     pitching scores 0 in a points league, and in a category league only the ratio inputs (ER, hits and
 *     walks allowed, outs) are removed, so ERA and WHIP go unqualified while W / SV / K still count.
 *   - Minimums are judged on the stored data as it stands, so mid-week the score is the score the week
 *     would end with if no more games were played. The live indicator says how far off the minimum is.
 *   - Caps count only STARTING-LINEUP games (bench and IL days add nothing — owner, 2026-10-25), and only
 *     games that COUNTED: a day zeroed by the cap adds nothing to usage. A week voided by
 *     a minimum does not refund cap usage — the games were played in the slot.
 *
 * Only daily-lineup leagues are scored this way: a cap needs to know which slot a player held on each
 * day, and only `redraft_daily_lineups` + `player_daily_scores` record that. The settings PATCH refuses
 * the rules for any other league rather than store a setting nothing reads.
 *
 * This module is pure. `gamesLimitsScoring.ts` loads the season ledger; `scoringEngine.ts` applies the
 * step AFTER each started day's points are known and before they are summed.
 */

export const GAMES_LIMITS_SETTINGS_KEY = 'games_limits'

export type GamesLimits = {
  /** Normalized starter slot token → max games PER SEAT for the season. */
  gamesPlayedCaps?: Record<string, number>
  /** NHL: minimum goalie games per week. */
  goalieMinStarts?: number
  /** MLB: minimum innings pitched per week (whole innings). */
  inningsMin?: number
  /** MLB: maximum innings pitched per week (whole innings). */
  inningsMax?: number
}

const CAP_SPORTS = new Set(['NBA', 'NHL', 'MLB'])
const KNOWN_KEYS = new Set(['gamesPlayedCaps', 'goalieMinStarts', 'inningsMin', 'inningsMax'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Starter slot tokens a cap may name: the league's own roster plus the sport's default slots. */
export function capSlotTokens(sport: string, leagueSettings: unknown): string[] {
  const tokens = new Set<string>()
  for (const t of resolveRedraftRosterConfig(sport, leagueSettings).starterCapacities.keys()) tokens.add(normalizeToken(t))
  for (const t of getRedraftSportConfig(sport).starterSlots) tokens.add(normalizeToken(t))
  return [...tokens]
}

/** Seats per starter slot in this league (a cap is per seat). */
export function slotSeats(sport: string, leagueSettings: unknown): Map<string, number> {
  const out = new Map<string, number>()
  for (const [t, n] of resolveRedraftRosterConfig(sport, leagueSettings).starterCapacities) {
    out.set(normalizeToken(t), (out.get(normalizeToken(t)) ?? 0) + n)
  }
  return out
}

function wholeNumberIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

export type GamesLimitsParse = { ok: true; value: GamesLimits | null } | { ok: false; error: string }

/**
 * Validate a commissioner's `gamesLimits` body. `null`, `{}` and an all-empty object mean OFF (stored as
 * null). Every rule is sport-gated; a value out of range, an unknown key or a slot the sport has no seat
 * for is refused rather than dropped, so a typo cannot save as "off".
 */
export function parseGamesLimits(raw: unknown, sport: string, leagueSettings: unknown): GamesLimitsParse {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) return { ok: false, error: 'gamesLimits must be an object or null' }
  const sp = String(sport ?? '').toUpperCase()
  for (const k of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(k)) return { ok: false, error: `Unknown gamesLimits setting: ${k}` }
  }
  const out: GamesLimits = {}

  if (raw.gamesPlayedCaps != null) {
    if (!isRecord(raw.gamesPlayedCaps)) return { ok: false, error: 'gamesPlayedCaps must be an object of slot → games' }
    const entries = Object.entries(raw.gamesPlayedCaps).filter(([, v]) => v !== null && v !== '')
    if (entries.length > 0) {
      if (!CAP_SPORTS.has(sp)) return { ok: false, error: 'Games-played caps are available for NBA, NHL and MLB leagues only' }
      const allowed = new Set(capSlotTokens(sp, leagueSettings))
      const caps: Record<string, number> = {}
      for (const [slot, v] of entries) {
        const token = normalizeToken(slot)
        if (!allowed.has(token)) return { ok: false, error: `Games-played cap names a slot this league does not start: ${slot}` }
        const n = wholeNumberIn(v, 1, 200)
        if (n == null) return { ok: false, error: `Games-played cap for ${slot} must be a whole number from 1 to 200` }
        caps[token] = n
      }
      out.gamesPlayedCaps = caps
    }
  }

  if (raw.goalieMinStarts != null && raw.goalieMinStarts !== '') {
    if (sp !== 'NHL') return { ok: false, error: 'The goalie minimum is available for NHL leagues only' }
    const n = wholeNumberIn(raw.goalieMinStarts, 1, 7)
    if (n == null) return { ok: false, error: 'goalieMinStarts must be a whole number from 1 to 7' }
    out.goalieMinStarts = n
  }

  for (const key of ['inningsMin', 'inningsMax'] as const) {
    if (raw[key] == null || raw[key] === '') continue
    if (sp !== 'MLB') return { ok: false, error: 'Innings limits are available for MLB leagues only' }
    const n = wholeNumberIn(raw[key], 1, 200)
    if (n == null) return { ok: false, error: `${key} must be a whole number of innings from 1 to 200` }
    out[key] = n
  }
  if (out.inningsMin != null && out.inningsMax != null && out.inningsMin > out.inningsMax) {
    return { ok: false, error: 'inningsMin cannot be greater than inningsMax' }
  }

  return { ok: true, value: Object.keys(out).length > 0 ? out : null }
}

/**
 * The league's active limits, or null (the default — scoring is then untouched). Lenient: a stored value
 * that no longer validates (say the sport's roster changed) reads as off rather than throwing in scoring.
 */
export function readGamesLimits(leagueSettings: unknown, sport: string | null | undefined): GamesLimits | null {
  if (!isRecord(leagueSettings) || !sport) return null
  const parsed = parseGamesLimits(leagueSettings[GAMES_LIMITS_SETTINGS_KEY], sport, leagueSettings)
  return parsed.ok ? parsed.value : null
}

/** One starter-day: a player who sat in a starting slot on an Eastern day and has a stat line for it. */
export type LimitLedgerEntry = {
  /** YYYY-MM-DD Eastern scoring day. */
  day: string
  playerId: string
  /** Normalized starter slot token held that day. */
  slot: string
  /** Normalized position tokens (`PG/SG` → ['PG', 'SG']). */
  positions: string[]
  gamesPlayed: number
  stats: Record<string, number>
}

export type GamesLimitsSummary = {
  /** Season games used per capped slot, through this week, against the slot's total (cap × seats). */
  caps?: { slot: string; used: number; cap: number }[]
  goalieStarts?: { count: number; min: number; met: boolean }
  /** Innings as outs (exact thirds). */
  innings?: { outs: number; minOuts?: number; maxOuts?: number; minMet?: boolean; maxReached?: boolean }
}

const PITCHING_RATIO_INPUTS = ['er', 'p_h', 'p_bb', 'outs', 'ip']

function without(stats: Record<string, number>, drop: (key: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(stats)) if (!drop(k)) out[k] = v
  return out
}

const isGoalieKey = (k: string) => k.startsWith('g_')

function outsOf(stats: Record<string, number>): number {
  const outs = stats.outs
  if (typeof outs === 'number' && Number.isFinite(outs)) return outs
  const ip = stats.ip
  return typeof ip === 'number' && Number.isFinite(ip) ? Math.round(ip * 3) : 0
}

function byDay<T extends { day: string }>(rows: readonly T[]): [string, number[]][] {
  const groups = new Map<string, number[]>()
  rows.forEach((r, i) => {
    const g = groups.get(r.day) ?? []
    g.push(i)
    groups.set(r.day, g)
  })
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Apply the league's limits to THIS week's starter-days. `prior` is every starter-day of the season
 * before this week (only caps read it). Returns this week's stat lines, index-aligned with `week`; an
 * untouched line is returned as the SAME object, so callers can keep the points they already computed.
 */
export function applyGamesLimits(args: {
  sport: string
  limits: GamesLimits
  scoringMode: 'points' | 'category'
  seats: ReadonlyMap<string, number>
  prior: readonly LimitLedgerEntry[]
  week: readonly LimitLedgerEntry[]
}): { stats: Record<string, number>[]; summary: GamesLimitsSummary } {
  const sport = String(args.sport).toUpperCase()
  const stats = args.week.map((e) => e.stats)
  const capped = new Array<boolean>(args.week.length).fill(false)
  const summary: GamesLimitsSummary = {}

  // 1. Games-played caps — season scope, chronological across prior weeks and this one.
  const caps = args.limits.gamesPlayedCaps
  if (caps && Object.keys(caps).length > 0) {
    const total = (slot: string) => caps[slot] * Math.max(1, args.seats.get(slot) ?? 1)
    const usage = new Map<string, number>()
    const all = [...args.prior.map((e) => ({ e, weekIdx: -1 })), ...args.week.map((e, i) => ({ e, weekIdx: i }))]
    for (const [, idxs] of byDay(all.map((x) => x.e))) {
      const usedAtStart = new Map(usage)
      for (const i of idxs) {
        const { e, weekIdx } = all[i]
        if (caps[e.slot] == null) continue
        if ((usedAtStart.get(e.slot) ?? 0) >= total(e.slot)) {
          if (weekIdx >= 0) capped[weekIdx] = true
          continue
        }
        usage.set(e.slot, (usage.get(e.slot) ?? 0) + Math.max(0, e.gamesPlayed))
      }
    }
    summary.caps = Object.keys(caps)
      .sort()
      .map((slot) => ({ slot, used: usage.get(slot) ?? 0, cap: total(slot) }))
    capped.forEach((c, i) => {
      if (c) stats[i] = {}
    })
  }

  // 2. MLB innings maximum — weekly, chronological; the day that reaches it counts in full.
  const pitching = (k: string) => MLB_PITCHING_STAT_KEYS.has(k)
  if (sport === 'MLB' && (args.limits.inningsMax != null || args.limits.inningsMin != null)) {
    const maxOuts = args.limits.inningsMax != null ? args.limits.inningsMax * 3 : null
    let outs = 0
    let maxReached = false
    for (const [, idxs] of byDay(args.week)) {
      const over = maxOuts != null && outs >= maxOuts
      for (const i of idxs) {
        if (capped[i]) continue
        if (over) {
          if (Object.keys(stats[i]).some(pitching)) stats[i] = without(stats[i], pitching)
          continue
        }
        outs += outsOf(stats[i])
      }
      if (over) maxReached = true
    }
    if (maxOuts != null && outs >= maxOuts) maxReached = true

    // 3. MLB innings minimum — judged on the innings that counted.
    const minOuts = args.limits.inningsMin != null ? args.limits.inningsMin * 3 : null
    const minMet = minOuts == null ? undefined : outs >= minOuts
    if (minMet === false) {
      const drop = args.scoringMode === 'category' ? (k: string) => PITCHING_RATIO_INPUTS.includes(k) : pitching
      stats.forEach((s, i) => {
        if (Object.keys(s).some(drop)) stats[i] = without(s, drop)
      })
    }
    summary.innings = {
      outs,
      ...(minOuts != null ? { minOuts, minMet } : {}),
      ...(maxOuts != null ? { maxOuts, maxReached } : {}),
    }
  }

  // 4. NHL goalie minimum — weekly; goalie games that counted, from starting goalies.
  if (sport === 'NHL' && args.limits.goalieMinStarts != null) {
    const min = args.limits.goalieMinStarts
    const isGoalieDay = (i: number) =>
      !capped[i] && args.week[i].positions.includes('G') && Object.keys(args.week[i].stats).some(isGoalieKey)
    let count = 0
    args.week.forEach((e, i) => {
      if (isGoalieDay(i)) count += Math.max(0, e.gamesPlayed)
    })
    const met = count >= min
    if (!met) {
      stats.forEach((s, i) => {
        if (Object.keys(s).some(isGoalieKey)) stats[i] = without(s, isGoalieKey)
      })
    }
    summary.goalieStarts = { count, min, met }
  }

  return { stats, summary }
}
