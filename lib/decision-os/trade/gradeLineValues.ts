import type { TradeGradeLine } from './tradeGrade'

/**
 * Which league value THE grade priced each displayed asset at — the one matcher every trade surface
 * uses to print a number beside an asset. PURE, and client-safe.
 *
 * 🛑 NEVER PAIR A CARD'S ASSETS WITH THE GRADE'S LINES BY POSITION ALONE (2026-10-01). A completed
 * trade's letter is its FROZEN original (`frozenCompletedGrade.ts`), stored with the `lines` of
 * whichever surface graded it first, in THAT surface's order — and matched back to a trade by asset
 * SET, not by order. The ledger lists picks in one order, the grader in another, so a positional
 * pairing printed "2027 round 2 — 3,034 / 2027 round 1 — 1,559" under a sentence calling the 2027
 * 1st the most valuable asset in the deal (HailShiva, CaliMike85 ↔ Manifest Destiny).
 */

/** One asset as a surface displays it. `gradedAs`: the name it was priced under (a used pick → its drafted player). */
export type DisplayedAsset = { label: string; gradedAs?: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * `year:round` for a draft-pick name in any spelling the surfaces use — the ledger's
 * "2027 round 1", the grader's "2027 1st", the email's "2027 1st round pick", a chart's
 * "2027 Pick 1.04" — or null when the name is not a pick.
 */
export function pickKey(name: string): string | null {
  const m = name.match(/\b(\d{4})\b.*?\b(?:round\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)|pick\s*(\d{1,2})\.\d{1,2})\b/i)
  return m ? `${m[1]}:${Number(m[2] ?? m[3] ?? m[4])}` : null
}

/**
 * The league value the grade priced each asset at, in the assets' own order.
 *
 * Matched by NAME first (a used pick by the player drafted with it), then an unused pick by YEAR and
 * ROUND, then — only when what is left on the side pairs up one-for-one — by position, which is the
 * order the grader priced them in. An asset nothing matches reads null and renders no number: a
 * guessed value beside a real letter is the thing the grade exists to refuse.
 */
export function assetValues(
  assets: ReadonlyArray<DisplayedAsset>,
  lines: ReadonlyArray<TradeGradeLine>,
  side: 'give' | 'get',
): Array<number | null> {
  const pool = lines.filter(l => l.side === side).map(l => ({ line: l, used: false }))
  const out: Array<number | null> = assets.map(a => {
    const want = norm(a.gradedAs ?? a.label)
    const hit = pool.find(p => !p.used && norm(p.line.name) === want)
    if (!hit) return null
    hit.used = true
    return hit.line.leagueValue
  })
  out.forEach((v, i) => {
    const a = assets[i]!
    // A used pick is priced as its drafted player, which the name pass already had its chance at.
    const key = v == null && !a.gradedAs ? pickKey(a.label) : null
    if (!key) return
    const hit = pool.find(p => !p.used && pickKey(p.line.name) === key)
    if (!hit) return
    hit.used = true
    out[i] = hit.line.leagueValue
  })
  const openAssets = out.map((v, i) => (v == null ? i : -1)).filter(i => i >= 0)
  const openLines = pool.filter(p => !p.used)
  if (openAssets.length > 0 && openAssets.length === openLines.length) {
    openAssets.forEach((idx, k) => { out[idx] = openLines[k]!.line.leagueValue })
  }
  return out
}
