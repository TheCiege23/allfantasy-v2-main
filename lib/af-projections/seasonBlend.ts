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
 */

export const BLEND_GAMES = 20

/** Sports the writer blends. Owner's order: NBA first; each other sport is a deliberate addition. */
export const BLEND_SPORTS: ReadonlySet<string> = new Set(['NBA'])

const RATE_KEY = /per_game|percentage|_pct$|^pct_|_avg$|^avg_/i

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

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
    const na = num(a)
    const nb = num(b)
    if (na == null && nb == null) {
      if (a !== undefined) out[key] = a
      continue
    }
    if (RATE_KEY.test(key)) {
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
