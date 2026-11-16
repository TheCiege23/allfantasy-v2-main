/**
 * Early-season BLEND of two season lines into one (2026-11-16, owner's decision for NBA values: "blend
 * with last season, shift to this season as games pile up").
 *
 * Before this, the writer chose ONE season per player: this season's line once he had
 * MIN_CURRENT_SEASON_GAMES (3), otherwise last season's. So a star's projection jumped from a full
 * prior season to three games of this one, and the value board — which refuses a projection on fewer
 * than 10 games — then refused him for a week. A blend moves gradually instead:
 *
 *   per-game = w × this season + (1 − w) × last season,   w = g / (g + BLEND_GAMES)
 *
 * so after 5 games this season counts 20%, after 20 games 50%, after 60 games 75%.
 *
 * The result is a season line in the SAME shape the writer already reads (`regular_season` totals), so
 * nothing downstream changes:
 *   - every TOTAL is rewritten so total / games_played is the blended per-game rate;
 *   - a field that is already a rate (`…_per_game`, `…percentage`, `…_pct`) is blended directly;
 *   - `games_played` is the games in BOTH seasons — what the projection really rests on, and what the
 *     "N games in the season sample" reason and the value board's sample bar read.
 *
 * Pure. Nested groups (MLB's batting / pitching) are blended the same way, one level down.
 *
 * ⚾ BASEBALL (MLB joined 2026-11-16). Its line differs in four ways, each handled here rather than
 * downstream:
 *   - INNINGS ARE BASEBALL NOTATION (`IP: '187.2'` is 187⅔). Blended as true innings, then written back in
 *     notation — a plain decimal like 190.15 would be read by the normalizer as 190⅔.
 *   - RATE STATS (ERA, AVG, WHIP, OBP, SLG, OPS, …) blend as rates; summed per game they would be nonsense.
 *   - NUMBERS ARRIVE AS STRINGS (`IP: '187.2'`, `ERA: '1.97'` — measured on production's 2025 rows).
 *   - IDS ride in the line (`player_id`): kept, never blended.
 * A group missing this season (a pitcher who batted last year and not this one) counts as zero this season.
 */

export const BLEND_GAMES = 20

/** Sports the writer blends. Owner's order: NBA first; each other sport is a deliberate addition. */
export const BLEND_SPORTS: ReadonlySet<string> = new Set(['NBA', 'MLB'])

const RATE_KEY = /per_game|percentage|_pct$|^pct_|_avg$|^avg_/i
/** Baseball's rate stats, by their vendor names (any case). */
const BASEBALL_RATE_KEY = /^(era|avg|obp|slg|ops|whip|babip|fip|xfip|baa|k\/9|bb\/9|h\/9|hr\/9|k\/bb)$/i
/** An identifier riding in a stat line: kept as it is, never blended. */
const ID_KEY = /(^|_)id$/i
/** Innings pitched, in baseball notation. */
const INNINGS_KEY = /^ip$/i

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // Baseball's vendor sends some numbers as strings ('187.2', '1.97'); anything else stays a string.
  if (typeof v === 'string' && /^-?[0-9]+([.][0-9]+)?$/.test(v.trim())) return Number(v)
  return null
}

/** Baseball notation -> true innings: 187.2 -> 187.667. The tenths digit counts outs (0–2). */
function trueInnings(notation: number): number {
  const whole = Math.trunc(notation)
  const outs = Math.round((notation - whole) * 10)
  return outs >= 0 && outs <= 2 ? whole + outs / 3 : notation
}

/** True innings -> baseball notation, to the nearest out: 190.333 -> 190.1. */
export function inningsNotation(innings: number): number {
  let whole = Math.floor(innings)
  let outs = Math.round((innings - whole) * 3)
  if (outs === 3) {
    whole += 1
    outs = 0
  }
  return whole + outs / 10
}

export function blendWeight(currentGames: number): number {
  return currentGames > 0 ? currentGames / (currentGames + BLEND_GAMES) : 0
}

function blendGroup(cur: Rec, prev: Rec, gCur: number, gPrev: number, w: number, gTotal: number): Rec {
  const out: Rec = {}
  for (const key of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
    if (key === 'games_played') continue
    const a = cur[key]
    const b = prev[key]
    if (isRec(a) || isRec(b)) {
      out[key] = blendGroup(isRec(a) ? a : {}, isRec(b) ? b : {}, gCur, gPrev, w, gTotal)
      continue
    }
    if (ID_KEY.test(key)) {
      out[key] = a !== undefined && a !== null ? a : b
      continue
    }
    const na = num(a)
    const nb = num(b)
    if (na == null && nb == null) {
      if (a !== undefined) out[key] = a
      continue
    }
    if (INNINGS_KEY.test(key)) {
      // Blended as true innings, written back in notation, so the normalizer reads it as it reads any line.
      const rate = w * (na == null ? 0 : trueInnings(na) / gCur) + (1 - w) * (nb == null ? 0 : trueInnings(nb) / gPrev)
      out[key] = inningsNotation(rate * gTotal)
      continue
    }
    if (RATE_KEY.test(key) || BASEBALL_RATE_KEY.test(key)) {
      // Already per game / a percentage: blend the rate itself. A side without it does not count.
      out[key] = na == null ? nb : nb == null ? na : w * na + (1 - w) * nb
      continue
    }
    // A total: blend per game, then scale back to the combined games so total / games = the blend.
    // A stat missing from one season is 0 there — he did not record it.
    const rate = w * ((na ?? 0) / gCur) + (1 - w) * ((nb ?? 0) / gPrev)
    out[key] = rate * gTotal
  }
  return out
}

/** The blend a stat line carries (`stats.seasonBlend`), or null when it is a single season's line. */
export function readSeasonBlend(stats: unknown): { currentGames: number; previousGames: number; currentWeight: number } | null {
  const b = isRec(stats) ? stats.seasonBlend : null
  if (!isRec(b)) return null
  const c = num(b.currentGames)
  const p = num(b.previousGames)
  const w = num(b.currentWeight)
  return c != null && p != null && w != null && c > 0 && p > 0 ? { currentGames: c, previousGames: p, currentWeight: w } : null
}

/**
 * One blended stat line from this season's and last season's, or null when either has no games (the
 * caller then keeps whichever line exists). Top-level metadata (position, team, name) is this season's.
 */
export function blendSeasonStats(current: unknown, previous: unknown): { stats: Rec; currentGames: number; previousGames: number; weight: number } | null {
  if (!isRec(current) || !isRec(previous)) return null
  const cr = current.regular_season
  const pr = previous.regular_season
  if (!isRec(cr) || !isRec(pr)) return null
  const gCur = num(cr.games_played) ?? 0
  const gPrev = num(pr.games_played) ?? 0
  if (gCur <= 0 || gPrev <= 0) return null
  const w = blendWeight(gCur)
  const gTotal = gCur + gPrev
  const regular = { ...blendGroup(cr, pr, gCur, gPrev, w, gTotal), games_played: gTotal }
  return {
    stats: { ...current, regular_season: regular, seasonBlend: { currentGames: gCur, previousGames: gPrev, currentWeight: Number(w.toFixed(3)) } },
    currentGames: gCur,
    previousGames: gPrev,
    weight: w,
  }
}
