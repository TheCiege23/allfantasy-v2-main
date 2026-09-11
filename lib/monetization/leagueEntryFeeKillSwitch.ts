/**
 * Server-side kill switch for league entry-fee processing.
 *
 * 🛑 THE CODE AND THE PUBLISHED TERMS SAY OPPOSITE THINGS, AND THE TERMS ARE PUBLIC.
 *
 *   app/disclaimer/page.tsx      "AllFantasy does not collect, hold, or
 *                                 distribute league dues or entry fees."
 *   app/terms/page.tsx           "AllFantasy does not collect league dues…"
 *   lib/legal/FanCredBoundaryDisclosure.ts
 *                                "does not process league dues, hold funds, or
 *                                 distribute winnings."
 *   lib/monetization/compliance-guardrails.ts
 *                                "does not process league dues in-app."
 *
 * Meanwhile `app/api/leagues/[leagueId]/finance/entry-checkout/route.ts` creates
 * a Stripe Checkout session with `purchaseType: 'league_entry_fee'`, and the
 * webhook writes `LeagueDues` and increments a league treasury balance.
 *
 * ⚠ AND THE GUARD THAT WOULD HAVE CAUGHT THIS ALREADY EXISTS. `PROHIBITED_INTENT_PATTERNS`
 * in `compliance-guardrails.ts` matches `entry[_\s-]*fee` and maps it to
 * `in_app_dues_not_allowed`. Five checkout routes call
 * `assertNoLeagueSettlementIntent` — bracket/donate, bracket/stripe/checkout,
 * monetization/checkout/subscription, monetization/checkout/tokens, and
 * stripe/create-checkout-session. The entry-fee route is the ONLY checkout route
 * that does not, and it is the only one that actually charges an entry fee.
 *
 * 🛑 FAIL CLOSED, AND ON AN EXACT `'true'`.
 *
 * The default is DISABLED. A feature that contradicts published terms must not
 * come back on because a variable happened to be present — this repo has already
 * shipped a gate that tested a flag's PRESENCE and was therefore always on (see
 * CLAUDE.md on `HAS_DB = Boolean(process.env.DATABASE_URL)`). So `'1'`, `'yes'`,
 * `'TRUE'` and an empty string all mean disabled; only the exact string `'true'`
 * enables it.
 *
 * Re-enabling is a legal decision, not an engineering one. It belongs to the
 * user and their lawyer, together with a rewrite of the terms, the money-flow
 * architecture, licensing, and the compliance controls.
 */

export const LEAGUE_ENTRY_FEE_ENV_VAR = 'ALLFANTASY_LEAGUE_ENTRY_FEE_ENABLED'

/**
 * True only when the operator has explicitly turned entry-fee processing on.
 *
 * Reads `process.env` on every call rather than caching at module load, so a
 * test can flip it and so a long-lived server process picks up a change without
 * a deploy.
 */
export function isLeagueEntryFeeProcessingEnabled(): boolean {
  return process.env[LEAGUE_ENTRY_FEE_ENV_VAR] === 'true'
}

export class LeagueEntryFeeDisabledError extends Error {
  readonly code = 'league_entry_fee_disabled' as const
  readonly statusCode = 403

  constructor(detail?: string) {
    super(
      'AllFantasy does not process league dues or entry fees. ' +
        'Paid-league money is handled externally by the commissioner.' +
        (detail ? ` (${detail})` : '')
    )
    this.name = 'LeagueEntryFeeDisabledError'
  }
}

export function isLeagueEntryFeeDisabledError(e: unknown): e is LeagueEntryFeeDisabledError {
  return e instanceof LeagueEntryFeeDisabledError
}

/**
 * Throws unless entry-fee processing has been explicitly enabled.
 *
 * `detail` is for the SERVER-side record only — the webhook puts the Stripe
 * session id in it so a refused fulfillment can be reconciled by a human. Do not
 * pass anything into it that should not appear in a client response, because the
 * route surfaces `.message`.
 */
export function assertLeagueEntryFeeProcessingEnabled(detail?: string): void {
  if (isLeagueEntryFeeProcessingEnabled()) return
  throw new LeagueEntryFeeDisabledError(detail)
}
