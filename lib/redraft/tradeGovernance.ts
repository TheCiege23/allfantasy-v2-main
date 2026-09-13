/**
 * How a redraft trade is reviewed is the LEAGUE's decision, never the proposer's.
 *
 * 🛑 WHY THIS MODULE EXISTS. Both redraft create paths — `/api/redraft/trade-proposals` and the
 * `create_proposal` action of `/api/redraft/trade-runtime` — copied `vetoMode` and `vetoThreshold` out of
 * the request body onto the proposal row. A direct caller could send `vetoMode: 'no_veto'` and have their
 * own trade settle the moment the receiver accepted, or `vetoThreshold: 1`, and the accept/vote guards in
 * `/api/redraft/trade-votes` would faithfully enforce the rule the proposer had just chosen.
 *
 * ⚠ AND THE HONEST UI WAS WRONG TOO. The Trade Center displays the league's saved review type
 * (`RedraftLeagueExtendedSettings.commissionerTradeReviewType`), but sends no `vetoMode`, so every proposal
 * it created fell to the `commissioner` default. A league saved as `league_vote` never got a league vote.
 *
 * The saved value is the source of truth. Its writers store `commissioner`, `league_vote`, `none` (league
 * creation, for a best-ball league with trades disabled), or a caller-provided `tradeSettings.reviewMode`.
 *
 *   league_vote          -> league_vote
 *   instant | no_veto    -> no_veto
 *   everything else      -> commissioner
 *
 * ⚠ `none` FAILS CLOSED, DELIBERATELY. The generic engine reads `none` as "no review", but the only redraft
 * writer of `none` means "trades are disabled" — so settling on accept would be the most wrong reading
 * available. Missing rows and unrecognised values fail closed for the same reason: a trade that waits for a
 * commissioner is recoverable; one that executed without review is not.
 *
 * Redraft leagues have no saved vote threshold, so the threshold is the server default every proposal
 * already used. The point is that the caller can no longer choose it.
 */
import type { PrismaClient } from '@prisma/client'

export type RedraftTradeVetoMode = 'commissioner' | 'league_vote' | 'no_veto'

/** No saved vote threshold exists for redraft leagues; this is the value proposals already defaulted to. */
export const REDRAFT_DEFAULT_VETO_THRESHOLD = 4

/**
 * Request-body fields that would let a caller choose governance. Refused with a 400, never silently
 * ignored: a caller that believes it set the rule should find out it did not.
 */
export const REDRAFT_TRADE_GOVERNANCE_FIELDS = ['vetoMode', 'vetoThreshold'] as const

export const REDRAFT_TRADE_GOVERNANCE_REFUSAL = 'Trade governance is controlled by persisted league settings.'

export function prohibitedRedraftGovernanceFields(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  return REDRAFT_TRADE_GOVERNANCE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field))
}

export function vetoModeFromReviewType(raw: unknown): RedraftTradeVetoMode {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'league_vote') return 'league_vote'
  if (value === 'instant' || value === 'no_veto') return 'no_veto'
  return 'commissioner'
}

export async function resolveRedraftTradeGovernance(
  db: Pick<PrismaClient, 'redraftLeagueExtendedSettings'>,
  leagueId: string,
): Promise<{ vetoMode: RedraftTradeVetoMode; vetoThreshold: number }> {
  const settings = await db.redraftLeagueExtendedSettings.findUnique({
    where: { leagueId },
    select: { commissionerTradeReviewType: true },
  })
  return {
    vetoMode: vetoModeFromReviewType(settings?.commissionerTradeReviewType),
    vetoThreshold: REDRAFT_DEFAULT_VETO_THRESHOLD,
  }
}
