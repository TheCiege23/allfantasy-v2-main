import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

/**
 * Does this play involve someone the user actually rosters?
 *
 * ⚠ THE TWO NAMES COME FROM DIFFERENT VENDORS AND WERE COMPARED WITH `===`.
 * The roster side is `SportsPlayer.name`; the play side is whatever Rolling
 * Insights called him. Measured on production 2026-08-30 against the 9,412
 * canonical RI names for the NFL: 8,664 match `SportsPlayer.name` exactly, so
 * 748 do not — and 208 of those differ by nothing but case, "Clark Phillips
 * Iii" against "Clark Phillips III". The rest are suffix and punctuation,
 * "James Pearce Jr." against "James Pearce Jr".
 *
 * ⚠ AND THE FAILURE IS SILENT AND TOTAL. No match means the "Biggest mover"
 * card does not render at all, which reads as a quiet afternoon rather than as
 * a broken join. That is the same shape as every other bug this codebase has
 * found in a name-keyed join: not a wrong answer, an absent one.
 *
 * `normalizeMatchName` is the repo's existing helper for exactly this —
 * lowercase, strip accents, punctuation and generational suffixes, collapse
 * whitespace. Its own docblock records that it is deliberately conservative and
 * "never strips enough to merge two genuinely different names", which is the
 * property that makes it safe to use for a bind rather than merely for a
 * lookup.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO. It does not fall back to a fuzzy or
 * partial match. The roster set here is the user's own players — tens, not
 * thousands — so a false positive would attribute another athlete's touchdown
 * to them, and the sibling module `playFeedPresentation` already refuses to
 * guess for the same reason: "a missing headshot is a cosmetic gap; the wrong
 * headshot on a touchdown alert is a visible, embarrassing error."
 */

/** The comparison keys for a roster, built once per render. */
export function rosterNameKeys(names: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const n of names) {
    const key = normalizeMatchName(n)
    if (key) out.add(key)
  }
  return out
}

/** Whether a play's player is in that roster, compared on the normalised name. */
export function isRosteredPlayer(keys: ReadonlySet<string>, playerName: string | null): boolean {
  const key = normalizeMatchName(playerName)
  return key ? keys.has(key) : false
}
