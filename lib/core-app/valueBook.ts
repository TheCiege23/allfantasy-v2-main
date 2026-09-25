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

import {
  readConfirmedLeagueConcept,
  readConfirmedPirateBase,
  resolveLeagueConcept,
} from '@/lib/league/leagueConceptOptions'

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

/**
 * Slots that let a quarterback start in a SECOND lineup spot — Sleeper, ESPN (`OP`, which
 * `EspnLeagueFetchService` maps to `SUPER_FLEX`), Yahoo (`Q/W/R/T`).
 */
const SUPERFLEX_SLOTS = new Set(['SUPER_FLEX', 'SUPERFLEX', 'SF', 'OP', 'QB/RB/WR/TE', 'QB/WR/RB/TE', 'Q/W/R/T'])

/**
 * Whether a league's lineup can start two quarterbacks. PURE; exported for tests.
 *
 * 🛑 THIS WAS AN EXACT MATCH ON SLEEPER'S SPELLING, AND EVERY OTHER IMPORTER WRITES `NAME:count`
 * (2026-09-25). ESPN, Yahoo, MFL and Fantrax store `roster_positions` as `"SUPER_FLEX:2"` /
 * `"QB:1"` (their adapters: `${slot}:${count}`), which never equals `"SUPER_FLEX"` — so an ESPN
 * superflex league priced on the 1QB chart. And a TWO-QB league (two plain `QB` starts, no flex
 * slot — 10 Sleeper leagues on production that day) priced 1QB too, though both formats trade
 * quarterbacks at the same premium, which is why FantasyCalc has one `numQbs: 2` chart for both.
 *
 * ⚠ ANY FLEX-QB SLOT STILL MEANS SUPERFLEX ON ITS OWN, exactly as before — 29 Sleeper leagues list
 * `SUPER_FLEX` and no plain `QB`; counting starts would have moved all of them off the chart they
 * are on today. The second rule only ADDS leagues.
 */
export function startsTwoQuarterbacks(positions: readonly unknown[]): boolean {
  let plainQb = 0
  for (const raw of positions) {
    const entry = String(raw ?? '').trim().toUpperCase()
    if (!entry) continue
    // `NAME:count`, where MFL can write a range (`QB:1-2`: up to two). A bare name counts once.
    const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(entry)
    const name = (m ? m[1] : entry).trim()
    const count = m ? Number(m[3] ?? m[2]) : 1
    if (!(count > 0)) continue
    if (SUPERFLEX_SLOTS.has(name)) return true
    if (name === 'QB') plainQb += count
  }
  return plainQb >= 2
}

/**
 * Formats whose rosters DISSOLVE — drafted fresh, emptied as teams go out — so nothing carries into
 * next season whatever the host platform's dynasty flag says. Always the redraft book.
 */
const ROSTER_DISSOLVING_CONCEPTS = new Set(['guillotine', 'survivor_guillotine', 'tournament'])

/**
 * The host platform's own facts about a league, as the importer stored them in `League.settings`.
 * Only consulted where a human has not confirmed the league type — see `leagueVariantFor`.
 */
function providerSaysDynasty(settings: Record<string, unknown>): boolean {
  return settings.isDynasty === true
}

function providerSaysKeeper(settings: Record<string, unknown>): boolean {
  const rules = settings.conceptRules
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return false
  const ext = (rules as Record<string, unknown>).extensions
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return false
  const kp = (ext as Record<string, unknown>).keeperProvenance
  if (!kp || typeof kp !== 'object' || Array.isArray(kp)) return false
  const p = kp as Record<string, unknown>
  return p.isKeeper === true && p.source === 'provider'
}

/**
 * Concepts whose rosters carry over, so future value is priced in — the ones
 * whose id does not literally contain "dynasty".
 *
 * 🛑 DEVY AND C2C WERE PRICED ON THE REDRAFT BOOK until 2026-09-16. Both are
 * dynasty-only formats (lib/league/keeper-policy.ts treats them as dynasty),
 * but the predicate below was a substring test for "dynasty", so confirming
 * either one in the picker moved the league OFF the dynasty book.
 *
 * `efl` is a label that prices on the dynasty book and nothing else (user
 * decision, 2026-09-16). Exact ids, not substrings: `c2c` must not match an
 * unrelated string that happens to contain it.
 *
 * `salary_cap` joined 2026-09-25: the format rules (`leagueFormatRules.ts`) and the
 * grading policy both treat it as a multi-season contract league, while this set
 * priced it on the REDRAFT book — the verdict and the notes beside it disagreed.
 */
const DYNASTY_SHELL_CONCEPTS = new Set(['devy', 'c2c', 'efl', 'salary_cap'])

/**
 * Whether a Pirate league carries rosters over.
 *
 * ⚠ A PIRATE CONFIRMATION WITHOUT A BASE PRICES AS DYNASTY. The picker cannot
 * save Pirate without the answer and the API rejects it — and the column now
 * receives the base, never `pirate` — so this only covers a legacy row whose
 * column says `pirate`, or a record written before the question existed. The
 * concept catalog calls Pirate dynasty-shelled (`pirate_vampire` is flattened
 * onto dynasty by normalizeConcept.ts), so that is the default — and a
 * commissioner who says "redraft" is always obeyed.
 */
function pirateCarriesOver(settings: unknown): boolean {
  return readConfirmedPirateBase(settings) !== 'redraft'
}

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
  const s = (settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}) as Record<string, unknown>
  const positions = Array.isArray(s.roster_positions) ? s.roster_positions : []
  const type = (resolveLeagueConcept(settings, leagueType) ?? '').toLowerCase()
  const confirmed = readConfirmedLeagueConcept(settings) != null
  /*
   * 🛑 A SPECIALTY FORMAT SITS ON A BASE, AND THE CONCEPT IS SINGLE-SELECT (2026-09-25). Confirming
   * `zombie` or `best_ball` on a Sleeper DYNASTY league replaced the only word this read — so the
   * league left the dynasty book the moment someone told us more about it. The host's own dynasty
   * flag answers the base question for any format that does not settle it itself. A format whose
   * rosters dissolve (`ROSTER_DISSOLVING_CONCEPTS`) settles it: redraft.
   */
  const specialtyOnABase =
    type !== '' &&
    type !== 'redraft' &&
    type !== 'keeper' &&
    type !== 'pirate' &&
    !type.includes('dynasty') &&
    !DYNASTY_SHELL_CONCEPTS.has(type) &&
    !ROSTER_DISSOLVING_CONCEPTS.has(type)
  return {
    superflex: startsTwoQuarterbacks(positions),
    dynasty:
      type.includes('dynasty') ||
      DYNASTY_SHELL_CONCEPTS.has(type) ||
      (type === 'pirate' && pirateCarriesOver(settings)) ||
      (specialtyOnABase && providerSaysDynasty(s)),
    /*
     * 🛑 SLEEPER KEEPER LEAGUES WERE STORED, LABELLED AND PRICED AS REDRAFT (2026-09-25). The
     * importer maps Sleeper `settings.type` 1 to `keeperProvenance.isKeeper` — kept — but the
     * concept inference has no keeper branch, so the column says `redraft`: 16 leagues on
     * production that day. The provider's own keeper fact now counts UNLESS a human confirmed a
     * type; a confirmation always wins, including a confirmed `redraft`.
     */
    keeper: type.includes('keeper') || (!confirmed && providerSaysKeeper(s)),
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
 * DEVY, C2C AND EFL price on DYNASTY; PIRATE follows the commissioner's
 * `baseFormat` answer and defaults to DYNASTY without one — see
 * `leagueVariantFor` above. SURVIVOR GUILLOTINE prices on REDRAFT: rosters are
 * drafted fresh and dissolve as teams are eliminated, so it takes the default
 * branch on purpose (its id contains neither "dynasty" nor "keeper").
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
