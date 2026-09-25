import type { PlayerNewsCategory } from '@/lib/news/player-news-category'
import { stripReleaseOfInformation } from '@/lib/news/releaseOfInformationPattern'

/**
 * Which player-news items are worth a notification — decided by EVENT CATEGORY, not by an
 * impact score.
 *
 * 🛑 THE RULE THIS REPLACES DELETED ORDINARY SIGNINGS. The pending dispatcher read:
 *
 *     if (row.impact !== 'high' && !isInjury) continue
 *
 * and `lib/workers/x-news-ingestion.ts` scores `signed` and `extension` as MEDIUM impact — they
 * are in `MEDIUM_IMPACT_KEYWORDS` by name. So a contract signing was suppressed by construction,
 * every time, and then stamped `notificationDispatchedAt` so it never got another chance. The
 * only signings that escaped were the ones whose text happened to contain an unrelated
 * high-impact word ("… after tearing his ACL last season"), which is the worst possible
 * selection rule: it fires on the wrong feature of the sentence.
 *
 * ⚠ IMPACT IS NOT DELETED, IT IS DEMOTED TO A TIEBREAK. A category that is materially about a
 * player's roster status qualifies on its own; a category that is not (team news, coaching,
 * game updates, unclassified chatter) still needs the impact score to earn an interruption.
 * Keeping the impact gate for those is what stops this becoming "notify on everything".
 */

/**
 * Which revision of the notify/skip rules produced a decision.
 *
 * 🛑 BUMP THIS WHENEVER A CHANGE COULD TURN A SKIP INTO A SEND — in THIS file, or in
 * `lib/news/player-news-category.ts`, whose category is this policy's main input. Both files
 * decide the same thing together, so a bump in one without the other is a lie.
 *
 * ⚠ WHAT IT IS FOR, STATED SO IT IS NOT MISTAKEN FOR TELEMETRY. A skipped story is stamped
 * `notificationDispatchedAt` and leaves the sweep's candidate set permanently, so a rule that
 * was WRONG silences that story for good — the sweep alone can never revisit it, because the
 * decision is deterministic over content that is not changing. This version is what lets
 * `lib/notifications/playerNewsPolicyReview.ts` find the skips a since-corrected rule produced
 * and put exactly those rows back. Without it, a re-review cannot tell a skip that would now be
 * sent from one that would be skipped identically, and would have to re-examine every one.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A CONTENT HASH OF THIS FILE. An automatic fingerprint bumps on a
 * comment edit and on a refactor that changes nothing, which trains everyone to ignore it. This
 * is a claim a human makes: "the answer for some past story may now be different."
 *
 * ── history ────────────────────────────────────────────────────────────────────────────────
 * 2 — …and the negation list conjugated in full: `deny` (the base form was missing, so a club
 *     denying a trade had it pushed as confirmed), plus `falls through`, `voids` and
 *     `rescinds`. Those move in the SKIP direction, so they do not need recovering — they are
 *     in the same version because they are the same rules revision, not because a review has
 *     to find them.
 * 2 — classifier batch. Keywords end-anchored (the `IR`/`PED`/`back`/`cut`/`deal`/`conduct`
 *     class); bare stems `sign`, `release`, `agree`, `activate` added, which is the form every
 *     plural-team-name headline uses; headline evidence now outranks body evidence at BOTH
 *     strengths; a disqualifier voids its own clause instead of the whole document; `injured
 *     reserve` no longer reads as an injury; the disclosure-boilerplate rule shared with this
 *     module rather than reimplemented. Every one of those turns some past `policy-skipped`
 *     into a send, which is exactly what a bump is for.
 * 1 — first versioned policy.
 */
export const PLAYER_NEWS_POLICY_VERSION = 2

export type NewsImpact = 'high' | 'medium' | 'low' | string

export type EligibilityDecision =
  | { eligible: true; reason: 'material-roster-event' | 'confirmed-trade' | 'high-impact' }
  | {
      eligible: false
      reason: 'not-material-and-not-high-impact' | 'unconfirmed-trade' | 'negated-event'
    }

/**
 * Categories where "it did not happen" is a thing a report says, and must not be sent as
 * though it did.
 *
 * 🛑 THIS IS NOT ALL CATEGORIES, AND THE EXCLUSIONS ARE THE WHOLE POINT.
 *
 * For a transaction, negation inverts the event: "will not be traded", "the deal was voided",
 * "the release was rescinded" all describe a move that is NOT happening, and every one of them
 * contains the vocabulary that says it is. Sending "traded to Chicago" about a player who is
 * staying is worse than sending nothing, because the user acts on it.
 *
 * ⚠ FOR AN INJURY, NEGATION IS THE NEWS ITSELF. "Will not play Sunday", "has not practiced",
 * "will not travel with the team" — a blanket negation rule suppresses exactly the alerts this
 * category exists to send. `suspension` reads the same way. So they are excluded, deliberately,
 * and widening this set is a decision rather than a tidy-up.
 */
const NEGATABLE_CATEGORIES: ReadonlySet<PlayerNewsCategory> = new Set([
  'trade',
  'signing',
  'release',
])

/**
 * Categories that change a player's real roster or availability status.
 *
 * These are exactly the events the blueprint lists under Availability and
 * Contracts/transactions — "Signing, extension, confirmed trade, release, activation,
 * call-up/send-down" — and every one of them is actionable for a manager regardless of how
 * loudly it was written.
 */
const MATERIAL_ROSTER_CATEGORIES: ReadonlySet<PlayerNewsCategory> = new Set([
  'injury',
  'suspension',
  'signing',
  'release',
  'roster_move',
])

/**
 * Wording that reports a trade as DONE.
 *
 * ⚠ THE CONFIRMED-ONLY RULE FOR REAL TRADES IS A PRODUCT DECISION, NOT AN ACCIDENT: "Notify
 * only on confirmed completion." A trade that is agreed, close, or being discussed is not a
 * trade, and a notification about one that then collapses is a correction the user never
 * needed. So the trade category — alone among the material ones — has to clear this bar.
 */
const TRADE_CONFIRMED_PATTERNS: readonly RegExp[] = [
  /\bhas been traded\b/i,
  /\bhave been traded\b/i,
  /\bwas traded\b/i,
  /\bwere traded\b/i,
  /\bis traded\b/i,
  /\btrade(?: is)? (?:official|finalized|finalised|complete[d]?|done)\b/i,
  /\bofficially (?:traded|acquired)\b/i,
  /\b(?:deal|trade) has been (?:completed|finalized|finalised)\b/i,
  /\btrading\b.*\bin exchange for\b/i,
]

/*
 * 🛑 A BARE "acquired" WAS IN THE LIST ABOVE AND HAD TO COME OUT.
 *
 * It is genuine trade vocabulary and it is not proof of anything: "reportedly acquired",
 * "could be acquired", "hoping to acquire" and "was nearly acquired" all contain it. It was
 * only ever safe because the hedge list happened to catch the common phrasings — which is
 * defence by coincidence, and it fails the moment a reporter writes a sentence the hedge list
 * has not seen. Confirmation must be positively established by wording that says the move
 * HAPPENED; `officially acquired` stays because that wording does say so.
 */


/**
 * Wording that marks a trade as NOT yet done.
 *
 * ⚠ CHECKED AFTER THE CONFIRMATION PATTERNS AND ALLOWED TO OVERRIDE THEM. "Reportedly acquired"
 * contains "acquired"; "expected to be traded" contains "traded". A confirmation list read on
 * its own promotes every rumour that happens to use the past participle, which is the same
 * incidental-keyword failure the impact gate above was making.
 */
const TRADE_HEDGE_PATTERNS: readonly RegExp[] = [
  /\breportedly\b/i,
  /\breport(?:s|ed)? (?:that|say|says)\b/i,
  /\brumou?r/i,
  /\bexpected to\b/i,
  /\blikely to\b/i,
  /\bcould be\b/i,
  /\bmay be\b/i,
  /\bin talks\b/i,
  /\bdiscussing\b/i,
  /\bexploring\b/i,
  /\bagreed to terms\b/i,
  /\bagreement in principle\b/i,
  /\bpending (?:a )?physical\b/i,
  /\bnearing\b/i,
  /\bclose to\b/i,
  /\bshopping\b/i,
]

/**
 * Wording that says the trade did NOT happen.
 *
 * 🛑 A NEGATED TRADE IS NOT A HEDGE, IT IS THE OPPOSITE OUTCOME, AND IT MATCHES THE
 * CONFIRMATION PATTERNS. "Star RB will not be traded" contains "be traded"; "the trade fell
 * through" and "GM denies the trade is done" both read as completion to a pattern list that
 * only knows how to spot the verb. Sending "traded to Chicago" about a player who is staying is
 * a worse failure than sending nothing, because the user will act on it.
 *
 * Checked alongside the hedges and with the same precedence: any hit here means not eligible.
 */
/**
 * ⚠ THE NEGATION MUST TOUCH THE TRANSACTION VERB, NOT MERELY APPEAR IN THE TEXT.
 *
 * The first version of this list matched any auxiliary followed by "not" —
 * `\b(?:will|is|was|were|has|…)\s+not\b`. It held a perfectly ordinary signing whose body read
 * **"Terms were not disclosed."**, which is boilerplate on roughly every contract story ever
 * written. A broad negation rule does not fail loudly; it silently deletes the category it was
 * added to protect.
 *
 * So the auxiliary forms below all require the negated word to BE the transaction, and the
 * standalone phrases are ones that cannot mean anything else ("fell through", "voided").
 */
const TRANSACTION_VERBS = String.raw`traded|trading|trade|dealt|dealing|signed|signing|sign|released|releasing|release|waived|waiving|acquired|acquiring|acquire|moving|move`

const TRADE_NEGATION_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:will|would|does|did|do|is|are|was|were|has|have|had)\s+not\s+(?:be\s+)?(?:${TRANSACTION_VERBS})\b`,
    'i',
  ),
  new RegExp(String.raw`\b(?:won|isn|aren|wasn|weren|didn|doesn)['’]t\s+(?:be\s+)?(?:${TRANSACTION_VERBS})\b`, 'i'),
  new RegExp(String.raw`\bnot\s+(?:be\s+)?(?:${TRANSACTION_VERBS})\b`, 'i'),
  /*
   * 🛑 CONJUGATED IN FULL, BECAUSE HALF-ENUMERATED INFLECTIONS ARE WHERE THIS LIST FAILS.
   *
   * `\bdenie[sd]\b` covered "denies" and "denied" and not the BASE FORM — so "Titans deny the
   * trade is done" was read as a confirmed trade and pushed as a completed move the club was
   * publicly denying. The docstring above names "Team denies the trade is done" as its worked
   * example, which is the tell: the example was written from the pattern rather than the pattern
   * from the language, so the gap could not be seen by reading either one.
   *
   * ⚠ THREE NEIGHBOURS HAD THE IDENTICAL GAP and are fixed in the same pass rather than left for
   * the next round to find one at a time: "trade falls through" (only `fell` was listed),
   * "voids the contract" (only `voided`), "rescinds the release" (only `rescinded`). This is the
   * same class the classifier batch just retired — a keyword table that covers the tense the
   * author happened to type.
   *
   * ⚠ AND THE DIRECTION MATTERS. Widening negation makes MORE items `negated-event`, which is a
   * TERMINAL policy skip — the silencing direction, so it is not automatically safe. It is safe
   * here for two reasons: `isNegatedTransaction` reads the HEADLINE only, and every phrase below
   * states that a transaction did not happen, where the failure being fixed is announcing one
   * that did not. Bare "void" is deliberately NOT matched — "void of talent" is a real headline
   * and "trade void" is not English anyone writes.
   */
  /\bden(?:y|ies|ied|ying)\b/i,
  /\bdebunk/i,
  /\bfall(?:s|ing)?\s+through\b/i,
  /\bfell\s+through\b/i,
  /\bcall(?:s|ed|ing)?\s+off\b/i,
  /\bvoid(?:s|ed|ing)\b/i,
  /\brescind(?:s|ed|ing)?\b/i,
]

/**
 * Negations that only make sense about a TRADE.
 *
 * ⚠ SEPARATE BECAUSE THEY ARE AMBIGUOUS ANYWHERE ELSE. "Remains with the club" is a negation
 * when the story is about trade rumours and is ordinary background when the story is a
 * contract extension — "the QB remains with the club after signing an extension" is a signing,
 * not a non-event. Scoping them to the trade category is what keeps that true.
 */
const TRADE_ONLY_NEGATION_PATTERNS: readonly RegExp[] = [
  /\bno trade\b/i,
  /\bstays? put\b/i,
  /\bremains? with\b/i,
  /\bstaying put\b/i,
]

/*
 * 🛑 THE DISCLOSURE-BOILERPLATE RULE NOW LIVES IN ONE PLACE, AND IT USED TO LIVE IN TWO.
 *
 * "The team did not release financial details" is contract boilerplate, not a non-release — the
 * same shape as the "terms were not disclosed" false positive above. This module stripped both
 * word orders; `lib/news/player-news-category.ts` needed the identical rule to stop `released`
 * classifying a re-signing as a release, and had its own copy covering only the ACTIVE order. So
 * "Terms were not released" was handled correctly here and incorrectly there, and fixing either
 * copy left the other wrong. Both now import the one definition.
 */

/**
 * Does this text say the transaction did NOT happen?
 *
 * `tradeContext` adds the trade-only phrases — pass it when the item is classified as a trade.
 */
export function isNegatedTransaction(
  headline: string,
  body: string | null | undefined,
  tradeContext = false,
): boolean {
  /*
   * 🛑 THE HEADLINE ONLY. A NEGATION IN THE BODY IS USUALLY ABOUT A DIFFERENT TRANSACTION.
   *
   * Matching a transaction verb anywhere in headline+body suppressed genuine signings outright:
   *
   *   "WR signs a three-year extension."
   *   "The team confirmed he will not be traded before the deadline."
   *       → `\bwill not be traded` matched → `negated-event` → and `policy-skipped` is
   *         TERMINAL, so the signing was stamped and never reconsidered.
   *
   * A denial of a rumour is routinely reported in the same paragraph as the extension that
   * prompted it, so this was not an edge case. The headline is the clause that carries the
   * classified event; that is the clause whose negation is about that event.
   *
   * ⚠ THE COST, STATED: a story whose headline is bare ("Contract update") and whose body
   * carries the negation is no longer caught here. For trades that is covered anyway —
   * `isConfirmedTrade` still requires positive completion wording over the whole text, and
   * "fell through" is not completion wording. For signings and releases it is a real gap, and
   * the safer one: over-delivering a signing is recoverable, permanently deleting one is not.
   */
  const text = stripReleaseOfInformation(String(headline ?? ''))
  if (TRADE_NEGATION_PATTERNS.some((re) => re.test(text))) return true
  return tradeContext && TRADE_ONLY_NEGATION_PATTERNS.some((re) => re.test(text))
}

export function isConfirmedTrade(headline: string, body: string | null | undefined): boolean {
  const text = stripReleaseOfInformation(`${headline ?? ''} ${body ?? ''}`)
  if (isNegatedTransaction(headline, body, true)) return false
  if (TRADE_HEDGE_PATTERNS.some((re) => re.test(text))) return false
  return TRADE_CONFIRMED_PATTERNS.some((re) => re.test(text))
}

export function decidePlayerNewsEligibility(input: {
  category: PlayerNewsCategory
  impact: NewsImpact
  headline: string
  body?: string | null
}): EligibilityDecision {
  const { category, impact, headline, body } = input

  /*
   * Negation first, and only for transaction categories. A voided deal, a rescinded release and
   * a trade that fell through are all reported in the vocabulary of the thing happening.
   */
  if (
    NEGATABLE_CATEGORIES.has(category) &&
    isNegatedTransaction(headline, body, category === 'trade')
  ) {
    return { eligible: false, reason: 'negated-event' }
  }

  if (category === 'trade') {
    return isConfirmedTrade(headline, body)
      ? { eligible: true, reason: 'confirmed-trade' }
      : { eligible: false, reason: 'unconfirmed-trade' }
  }

  if (MATERIAL_ROSTER_CATEGORIES.has(category)) {
    return { eligible: true, reason: 'material-roster-event' }
  }

  if (impact === 'high') return { eligible: true, reason: 'high-impact' }

  return { eligible: false, reason: 'not-material-and-not-high-impact' }
}
