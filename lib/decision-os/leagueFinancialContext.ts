/**
 * Fantasy OS Suite — Phase OS-A1: League Context Foundation.
 *
 * Decision OS's provider-agnostic BELIEF about whether real money is involved in a league, and how
 * confident that belief is. Deliberately separate from `LeagueFinance` (the existing AF-native
 * Stripe/PayPal treasury model for leagues that opt into AllFantasy's own paid-league feature) — this
 * module answers "what do we know about this league's financial context," not "how do we collect or
 * hold money." A league can have real money riding on it via LeagueSafe, FanCred, Yahoo, ESPN, or a
 * plain handshake deal with zero `LeagueFinance` rows ever created.
 *
 * Every function here is pure — no I/O, no Prisma, no network. Persistence (the
 * `DecisionOsLeagueContext` Prisma model) and any route/UI wiring are a separate, later phase; this
 * phase is the foundation only, per its own instructions.
 *
 * Core discipline, restated in code: **never fabricate confidence**. A fresh import (Sleeper today;
 * ESPN/Yahoo adapter hooks only, not yet implemented) always starts `UNKNOWN`/`UNKNOWN` — nothing
 * infers paid/free status from league chat, league name, or any other heuristic. Status only moves
 * off `UNKNOWN` through an explicit, traceable action: a user's own confirmation, or (once built) a
 * real escrow-provider verification.
 */

export type LeagueFinancialStatus = 'UNKNOWN' | 'FREE' | 'PAID' | 'VERIFIED_PAID'

/** Adapter hooks only (Phase OS-A1) — no real integration built for any of these yet. */
export type LeagueEscrowProvider =
  | 'LEAGUESAFE'
  | 'FANCRED'
  | 'YAHOO'
  | 'ESPN'
  | 'MANUAL'
  | 'OTHER'
  | 'UNKNOWN'

export type LeagueFinancialConfidence =
  | 'UNKNOWN'
  | 'USER_CONFIRMED'
  | 'PROVIDER_CONFIRMED'
  | 'ESCROW_VERIFIED'
  | 'INFERRED'

export interface LeagueFinancialContext {
  leagueId: string
  financialStatus: LeagueFinancialStatus
  buyInAmount: number | null
  buyInCurrency: string | null
  escrowProvider: LeagueEscrowProvider
  financialConfidence: LeagueFinancialConfidence
  financialNotes: string | null
  isUserConfirmed: boolean
  lastVerifiedAt: Date | null
}

/**
 * The honest starting state for any league Decision OS learns about, regardless of provider.
 * `provider` is accepted (and will matter once ESPN/Yahoo adapters exist) but currently has NO
 * effect on the result — every provider, including Sleeper, defaults to the same fully-unknown
 * context. There is deliberately no special-cased "Sleeper leagues are usually free" or similar
 * heuristic anywhere in this function.
 */
export function defaultLeagueFinancialContext(
  leagueId: string,
  _provider: string,
): LeagueFinancialContext {
  return {
    leagueId,
    financialStatus: 'UNKNOWN',
    buyInAmount: null,
    buyInCurrency: null,
    escrowProvider: 'UNKNOWN',
    financialConfidence: 'UNKNOWN',
    financialNotes: null,
    isUserConfirmed: false,
    lastVerifiedAt: null,
  }
}

export interface ManualFinancialConfirmationInput {
  /** Only FREE or PAID — a manual confirmation can never itself produce VERIFIED_PAID (see
   * `applyEscrowVerification`, the only path to that tier). */
  financialStatus: 'FREE' | 'PAID'
  buyInAmount?: number | null
  buyInCurrency?: string | null
  financialNotes?: string | null
  /** Optional — records which provider the commissioner SAYS they use (e.g. "we use LeagueSafe"),
   * as a plain label only. This is NOT a verified escrow confirmation — confidence stays
   * `USER_CONFIRMED` regardless of whether this is set (see `applyEscrowVerification` for the real,
   * higher-confidence path). Ignored (forced to `UNKNOWN`) when `financialStatus` is `FREE`. */
  escrowProvider?: LeagueEscrowProvider
}

/**
 * A real person (typically the commissioner) explicitly states whether this league is free or paid.
 * This is the ONLY way a league can move to `FREE` at all, and the ONLY way to reach `PAID` short of
 * a real escrow verification. Confidence becomes `USER_CONFIRMED` — a real, human-attributable claim,
 * not an inference — and `isUserConfirmed`/`lastVerifiedAt` are stamped accordingly.
 */
export function applyManualFinancialConfirmation(
  current: LeagueFinancialContext,
  input: ManualFinancialConfirmationInput,
  now: Date = new Date(),
): LeagueFinancialContext {
  const isFree = input.financialStatus === 'FREE'
  return {
    ...current,
    financialStatus: input.financialStatus,
    buyInAmount: isFree ? null : input.buyInAmount ?? current.buyInAmount,
    buyInCurrency: isFree ? null : input.buyInCurrency ?? current.buyInCurrency,
    escrowProvider: isFree ? 'UNKNOWN' : input.escrowProvider ?? current.escrowProvider,
    financialNotes: input.financialNotes ?? current.financialNotes,
    financialConfidence: 'USER_CONFIRMED',
    isUserConfirmed: true,
    lastVerifiedAt: now,
  }
}

/**
 * A real person explicitly retracts any prior claim — the league returns to the exact same honest
 * "we don't know" state as a freshly-imported league. A full reset, not a partial one: a lingering
 * buy-in amount or escrow provider label next to `UNKNOWN` status would itself be a form of
 * fabricated certainty, so every field is cleared, not just `financialStatus`.
 */
export function resetLeagueFinancialContext(leagueId: string, provider: string): LeagueFinancialContext {
  return defaultLeagueFinancialContext(leagueId, provider)
}

export interface EscrowVerificationInput {
  escrowProvider: Exclude<LeagueEscrowProvider, 'UNKNOWN'>
  buyInAmount?: number | null
  buyInCurrency?: string | null
  financialNotes?: string | null
}

/**
 * The adapter hook for a REAL escrow-provider verification (LeagueSafe, FanCred, Yahoo, ESPN, or a
 * manually-recorded external escrow). No provider is actually integrated yet (Phase OS-A1 is
 * foundation only) — this function exists so that whichever phase builds the first real integration
 * has an already-designed, already-tested shape to call into, rather than inventing one under
 * integration pressure. Calling it is the ONLY way to reach `VERIFIED_PAID`/`ESCROW_VERIFIED` — the
 * highest-confidence tier, reserved for a real external provider's own confirmation, not a
 * commissioner's unverified word.
 */
export function applyEscrowVerification(
  current: LeagueFinancialContext,
  input: EscrowVerificationInput,
  now: Date = new Date(),
): LeagueFinancialContext {
  return {
    ...current,
    financialStatus: 'VERIFIED_PAID',
    buyInAmount: input.buyInAmount ?? current.buyInAmount,
    buyInCurrency: input.buyInCurrency ?? current.buyInCurrency,
    escrowProvider: input.escrowProvider,
    financialConfidence: 'ESCROW_VERIFIED',
    financialNotes: input.financialNotes ?? current.financialNotes,
    isUserConfirmed: true,
    lastVerifiedAt: now,
  }
}

/** True only when the context carries a real, attributable basis — never true for `UNKNOWN`. */
export function isFinancialStatusConfident(context: LeagueFinancialContext): boolean {
  return context.financialConfidence !== 'UNKNOWN'
}

export function isConfidentlyPaid(context: LeagueFinancialContext): boolean {
  return (
    isFinancialStatusConfident(context) &&
    (context.financialStatus === 'PAID' || context.financialStatus === 'VERIFIED_PAID')
  )
}

export function isConfidentlyFree(context: LeagueFinancialContext): boolean {
  return isFinancialStatusConfident(context) && context.financialStatus === 'FREE'
}

const ESCROW_PROVIDER_LABELS: Record<LeagueEscrowProvider, string> = {
  LEAGUESAFE: 'LeagueSafe',
  FANCRED: 'FanCred',
  YAHOO: 'Yahoo',
  ESPN: 'ESPN',
  MANUAL: 'Manually recorded',
  OTHER: 'Other provider',
  UNKNOWN: 'Unknown provider',
}

export function describeEscrowProvider(provider: LeagueEscrowProvider): string {
  return ESCROW_PROVIDER_LABELS[provider]
}

/**
 * A short, honest, human-readable summary — never overclaims certainty the context doesn't have.
 */
export function describeLeagueFinancialContext(context: LeagueFinancialContext): string {
  if (context.financialStatus === 'UNKNOWN') {
    return 'Financial status unknown — no confirmation on file.'
  }
  if (context.financialStatus === 'FREE') {
    return context.isUserConfirmed
      ? 'Free league — confirmed by commissioner.'
      : 'Free league (unconfirmed).'
  }
  const amount =
    context.buyInAmount != null
      ? `${context.buyInCurrency ? context.buyInCurrency.toUpperCase() + ' ' : ''}${context.buyInAmount}`
      : 'an unspecified amount'
  if (context.financialStatus === 'VERIFIED_PAID') {
    return `Verified paid league — ${amount} buy-in, confirmed via ${describeEscrowProvider(context.escrowProvider)}.`
  }
  return `Paid league — ${amount} buy-in, confirmed by commissioner.`
}
