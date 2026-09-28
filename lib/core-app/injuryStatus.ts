/**
 * Reading an injury designation — absent, at risk, or nothing at all.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE POINT. "Questionable" and "doubtful" mean
 * uncertainty; treating them as absence would zero a projection and tell a
 * manager to bench someone who is probably playing. Only a declaration of
 * absence produces a zero.
 *
 * Extracted from lib/core-app/myTeam.ts so the roster-need model and the
 * projection column cannot disagree about who is available. A team whose kicker
 * is on IR has an empty kicker slot, and a need model that counts bodies rather
 * than available bodies cannot see it.
 */

/**
 * The status, reduced to comparable words.
 *
 * ⚠ TOKENS, NOT SUBSTRINGS, AND THE DOTS GO FIRST. This was a substring scan
 * over a space-padded string, which had two problems. `I.L.` — 116 rows — never
 * matched anything, because the punctuation broke every needle; and ` ir `
 * matches inside ordinary words (` air ` contains `ir`), so the old form could
 * rule out a status for a letter pair it happened to contain.
 */
function words(status: string): string[] {
  return status
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * A single token that on its own means the player is unavailable.
 *
 * ⚠ `il` IS NOT AN NFL SPELLING AND THAT IS WHY IT WAS MISSING. The injured
 * LIST is baseball and hockey vocabulary — `60-day IL`, `15-day IL`, `10-day IL`
 * and `I.L.` together are 435 rows in `sportsInjury`, measured 2026-08-29, and
 * not one of them was recognised. Every caller of this function is multi-sport:
 * `myTeam.ts` zeroes a projection on it, `myTeamPulse.ts` counts a lost starting
 * slot, and `tradeContextNotes.ts` marks a player unavailable in a trade. An
 * MLB starter on the 60-day IL was priced as available in all three.
 */
const ABSENT_TOKENS = new Set(['ir', 'il', 'pup', 'nfi', 'out'])

/** He is declared absent. A starter carrying this scores zero. */
export function isRuledOut(status: string | null | undefined): boolean {
  if (!status) return false
  const w = words(status)
  if (w.length === 0) return false
  if (w.some((t) => ABSENT_TOKENS.has(t))) return true
  /*
   * ⚠ THE PREFIX IS `suspen`, NOT `suspend`, AND THE DIFFERENCE IS 13 LIVE
   * ROWS. The table's actual spelling is "Suspension", which does not start
   * with "suspend" — so the old `t.includes('suspend')` scan matched a
   * suspended player only if a provider happened to write the verb. Every
   * suspension in `sportsInjury` today was being priced as available.
   */
  if (w.some((t) => t.startsWith('suspen'))) return true
  /* Reserve and list are the two long spellings; both are an absence. */
  if (w.includes('injured') && (w.includes('reserve') || w.includes('list'))) return true
  return w.join(' ').includes('did not play')
}

/**
 * He is OUT for a game — the game-day word, as distinct from the season-scale
 * rulings (IR, PUP, NFI, a suspension) that isRuledOut also covers. This is the
 * only designation a pregame inactive can wear (pregameInactive.ts): the NFL
 * folds its 90-minute inactive list into "Out", never into IR.
 */
export function isOutDesignation(status: string | null | undefined): boolean {
  if (!status) return false
  const w = words(status)
  if (!w.includes('out')) return false
  if (w.some((t) => t === 'ir' || t === 'il' || t === 'pup' || t === 'nfi' || t.startsWith('suspen'))) return false
  return true
}

/**
 * Values in the status column that carry NO designation at all.
 *
 * ⚠ "ACTIVE" IS THE SECOND MOST COMMON VALUE IN THE TABLE — 1,646 rows against
 * 4,115 "Questionable", measured 2026-08-29. A caller that treats "has a row in
 * `sportsInjury`" as "has a designation" therefore flags roughly a fifth of the
 * league as at-risk, and a caller that treats "any non-empty status" the same
 * way flags nine starters out of ten. Both were written; this exists so neither
 * is written again.
 *
 * `NA` and `Unrevealed` are the provider declining to say, which is an absence
 * of information rather than a report of risk — an amber chip on those is a
 * claim we do not have.
 */
const NO_DESIGNATION = ['active', 'healthy', 'na', 'n/a', 'none', 'unrevealed', 'unknown']

export function isHealthyDesignation(status: string | null | undefined): boolean {
  if (!status) return true
  return NO_DESIGNATION.includes(status.trim().toLowerCase())
}

/**
 * He is on the report and not ruled out — a risk, not a certainty.
 *
 * A bare body part ("Elbow", "Hamstring") counts: the provider put him on the
 * injury report, and that is exactly the population a manager wants flagged
 * before kickoff even when nobody has attached a word like "questionable" yet.
 */
export function isAtRisk(status: string | null | undefined): boolean {
  return !isHealthyDesignation(status) && !isRuledOut(status)
}

/**
 * Is he ruled out, judged from a dated injury FACT rather than a bare status string?
 *
 * ⚠ ONE RULE, SHARED. It was written inline in the waiver board (37ea538c5) and is needed again by
 * Chimmy's starters-playing count, which listed an Out QB as "playing tonight". Two copies of the
 * rule would drift the way the two SQL/JS name normalizers once did.
 *
 *   - `isRuledOut` on the status (IR, IL, PUP, NFI, Out, suspension).
 *   - EXCEPT a game-day "Out" that is stale: that is last week's news. Season-scale rulings (IR and
 *     the rest) still count when stale, because they hold for months.
 *   - No fact is not ruled out: a missing injury row is "no news", never "healthy" — and never "hurt".
 */
export function ruledOutByFact(fact: { status: string | null; stale: boolean } | null | undefined): boolean {
  if (!fact || !isRuledOut(fact.status)) return false
  if (fact.stale && isOutDesignation(fact.status)) return false
  return true
}
