/**
 * "Release" is two different verbs, and only one of them is a roster move.
 *
 * 🛑 THIS IS A DEFINITION SITE AND NOTHING ELSE, BECAUSE THE RULE WAS IMPLEMENTED TWICE AND THE
 * TWO COPIES DISAGREED.
 *
 * `playerNewsEligibility` strips this boilerplate before judging negation, and covers BOTH word
 * orders — the passive one ("Terms were not released") was added after the active-only version
 * ruled ordinary signings `negated-event`. `player-news-category` needed the same rule to stop
 * `\breleased` classifying a re-signing as a release, and grew its own disqualifier list written
 * from the ACTIVE form only. So the identical sentence was handled correctly in one module and
 * incorrectly in the other, and a fix to either left the other wrong.
 *
 * CLAUDE.md states the general form of this after a SQL copy of `normalizePlayerName` disagreed
 * with the real one on 7.2% of rows: "Two implementations of one rule is the bug. Deleting one
 * is the fix." This module is that deletion.
 *
 * ⚠ EXPORTED AS A SOURCE STRING, NOT AS A COMPILED RegExp. The consumers need different flags —
 * eligibility does a global `.replace()`, the classifier needs `matchAll` ranges to void the
 * matching CLAUSE rather than the whole document — and a shared `g`-flagged instance carries
 * `lastIndex` between callers, which is its own quiet bug.
 */

const INFO_NOUNS = String.raw`details|terms|information|figures|numbers|specifics|statement|breakdown`
const DISCLOSURE_VERBS = String.raw`released|disclosed|revealed|announced|shared|confirmed|made public`

/**
 * Active order: "did not release (the financial) details".
 *
 * ⚠ `a\s+|an\s+` ARE IN THE ARTICLE GROUP BECAUSE "released A statement" IS THE COMMONEST FORM
 * OF ALL. They were absent while this pattern was only ever used to strip text before a negation
 * check, where the indefinite article is rare ("did not release the details"). The classifier
 * needs the same pattern to recognise "The team released a statement", so their absence surfaced
 * the moment the two copies were merged — a gap that was invisible to the only caller that had
 * one.
 */
const ACTIVE = String.raw`\brelease(?:d|s|ing)?\s+(?:a\s+|an\s+|the\s+|any\s+|its\s+|their\s+)?(?:full\s+|financial\s+|contract\s+|salary\s+)?(?:${INFO_NOUNS})\b`

/**
 * Passive order: "terms were not released".
 *
 * ⚠ THE COMMONER PHRASING, AND THE FIRST VERSION MISSED IT ENTIRELY. With only the active order
 * stripped, the auxiliary-negation pattern matched `were not released`, the item was ruled
 * `negated-event`, and — because a policy skip is TERMINAL — an ordinary signing was stamped and
 * never reconsidered. It is boilerplate on a large share of contract stories.
 */
const PASSIVE = String.raw`\b(?:${INFO_NOUNS})\b(?:\s+of\s+(?:the\s+)?[a-z]+){0,3}\s+(?:were|was|have|has|had|are|is)?\s*(?:not\s+)?(?:been\s+)?(?:${DISCLOSURE_VERBS})\b`

/** Both word orders. Compile with the flags the call site needs. */
export const RELEASE_OF_INFORMATION_SOURCE = [ACTIVE, PASSIVE].join('|')

/**
 * Remove disclosure boilerplate so the surrounding sentence can be judged on its merits.
 *
 * ⚠ REMOVED, NOT SPECIAL-CASED IN EACH MATCHER. Excluding these phrases inside every pattern
 * that mentions `release` would have to be repeated in all of them, and the next one added would
 * forget.
 */
export function stripReleaseOfInformation(text: string): string {
  return text.replace(new RegExp(RELEASE_OF_INFORMATION_SOURCE, 'gi'), ' ')
}
