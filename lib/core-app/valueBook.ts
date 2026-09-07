/**
 * Which `PlayerValueSnapshot` book a league should be priced against.
 *
 * 🛑 THREE SURFACES HARDCODED `DYNASTY / SUPERFLEX` AND ALL THREE WERE WRONG FOR
 * A REDRAFT LEAGUE. The player card, the per-league Trades screen and the
 * cross-league trades board each copied the same two literals from each other,
 * deliberately — so that they could not disagree with one another. They agreed
 * perfectly, and were jointly wrong: a redraft league was priced off the dynasty
 * book, which values a 22-year-old rookie above a 30-year-old who will outscore
 * him this season.
 *
 * ⚠ THE DATA WAS NEVER MISSING. `lib/player-values/ingestPlayerValues.ts`
 * ingests all four books — DYNASTY/REDRAFT × ONE_QB/SUPERFLEX — and has done
 * throughout. Only one was ever read.
 *
 * ⚠ ONE DERIVATION, CONSUMED EVERYWHERE, AND THAT IS THE ENTIRE POINT OF THE
 * MODULE. The reason the three surfaces hardcoded the book was to stay
 * consistent with each other, which is a real requirement — two surfaces quoting
 * different prices for one player is worse than one surface quoting a wrong
 * book and saying so. Deriving it per surface would recreate exactly that
 * problem with more steps. `marketContextFor` in `playerTradeVisual.ts` reads
 * its variant from here too, so the trade engine and the value tables cannot
 * drift apart either.
 *
 * 🛑 REDRAFT COVERAGE IS HALF, AND THAT IS THE COST OF THIS FIX — STATED, NOT
 * HIDDEN. Measured on production 2026-09-07, in the LATEST capture (which is
 * what a read actually sees, one row per player):
 *
 *     DYNASTY  ONE_QB / SUPERFLEX   398 players priced
 *     REDRAFT  ONE_QB / SUPERFLEX   199 players priced
 *
 * So a redraft league now withholds roughly twice as many grades as it did
 * before. It was not grading them correctly before — it was grading them
 * confidently against the dynasty book, which prices a 22-year-old rookie above
 * a 30-year-old who will outscore him this season. A withheld grade with a
 * stated reason is the honest outcome; a number from the wrong book is not.
 *
 * ⚠ THE FIX IS NOT COSMETIC: of 257 claimed leagues on production, **174 (68%)
 * were on the wrong book** — 76 wrong on both axes, 65 on format, 33 on
 * qbFormat. Only the 83 dynasty-superflex leagues were right, and they were
 * right by accident.
 */

/** The three columns that identify a book in `PlayerValueSnapshot`. */
export type ValueBook = {
  /**
   * ⚠ A LICENCE BOUNDARY, NOT A TIDY FILTER, and it travels with the book so no
   * call site can forget it. DynastyProcess's value files are FantasyPros ECR
   * derivatives whose terms prohibit commercial use; FantasyCalc is the one
   * source here with no such encumbrance. Today only FantasyCalc rows exist, so
   * the filter is a no-op — which is exactly why it is pinned: the moment a
   * second source is ingested, an unfiltered query starts pricing on data we may
   * not be licensed to use, and nothing fails.
   */
  source: 'FANTASYCALC'
  format: 'DYNASTY' | 'REDRAFT'
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
}

/** Slots that mean a league starts two quarterbacks. */
const SUPERFLEX_SLOTS = new Set(['SUPER_FLEX', 'SUPERFLEX', 'QB/RB/WR/TE'])

/**
 * The league traits the value book and the trade engine both key on.
 *
 * Exported so `marketContextFor` can build its `variant` from the same
 * predicates rather than a second copy of them.
 */
export function leagueVariantFor(
  settings: unknown,
  leagueType: string | null
): { superflex: boolean; dynasty: boolean; keeper: boolean } {
  const s = (settings ?? {}) as Record<string, unknown>
  const positions = Array.isArray(s.roster_positions)
    ? s.roster_positions.map((p) => String(p).toUpperCase())
    : []
  const type = (leagueType ?? '').toLowerCase()
  return {
    superflex: positions.some((p) => SUPERFLEX_SLOTS.has(p)),
    dynasty: type.includes('dynasty'),
    keeper: type.includes('keeper'),
  }
}

/**
 * The book to price THIS league against.
 *
 * ⚠ KEEPER COUNTS AS DYNASTY, matching `getMarketValues` exactly
 * (`isDynasty = variant.dynasty || variant.keeper`). A keeper league carries
 * players across seasons, so future value is priced in; splitting it away from
 * dynasty here would make the card and the trade engine disagree on the same
 * league, which is the whole failure this module exists to prevent.
 *
 * ⚠ AND AN UNKNOWN `leagueType` FALLS TO REDRAFT, deliberately. `leagueType` is
 * nullable and defaults to `"redraft"` in the schema, so treating a missing
 * value as dynasty would put every unclassified league back on the book this fix
 * is removing — the failure would survive its own repair.
 */
export function valueBookFor(settings: unknown, leagueType: string | null): ValueBook {
  const v = leagueVariantFor(settings, leagueType)
  return {
    source: 'FANTASYCALC',
    format: v.dynasty || v.keeper ? 'DYNASTY' : 'REDRAFT',
    qbFormat: v.superflex ? 'SUPERFLEX' : 'ONE_QB',
  }
}

/**
 * The book for a surface with NO league in context — the universal player card.
 *
 * ⚠ THIS IS A STATED DEFAULT, NOT A DERIVED ANSWER, and the surface using it
 * must render the book on screen. With no league there is no correct format; the
 * only honest options are to show a labelled default or to show nothing. Dynasty
 * superflex is chosen because it is the book the rest of the app quotes, so a
 * reader moving from a global surface into a league sees a number that moves for
 * a reason they can name rather than one that changes silently.
 */
export const CROSS_LEAGUE_BOOK: ValueBook = {
  source: 'FANTASYCALC',
  format: 'DYNASTY',
  qbFormat: 'SUPERFLEX',
}

/** Stable key for caching values across several books in one map. */
export function valueBookKey(book: ValueBook, sleeperId: string): string {
  return `${book.format}:${book.qbFormat}:${sleeperId}`
}

/** How the card renders the basis — "redraft · 1QB", "dynasty · superflex". */
export function describeValueBook(book: ValueBook): string {
  return `${book.format.toLowerCase()} · ${book.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB'}`
}
