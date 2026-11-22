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
 * The vote threshold is the league's veto rule (lib/league-trade-engine/vetoRule.ts) — the number the
 * commissioner saved in Trade Settings, as votes or as a percent of the teams — the same rule the generic
 * engine reads. A league that saved none keeps 4 votes, the default every proposal already used. The
 * point stays that the caller can never choose it.
 */
import type { PrismaClient } from '@prisma/client'
import { DEFAULT_VETO_VOTES, readVetoRule, type VetoRule } from '@/lib/league-trade-engine/vetoRule'

export type RedraftTradeVetoMode = 'commissioner' | 'league_vote' | 'no_veto'

/** The threshold a league that saved no veto rule gets; the value proposals always defaulted to. */
export const REDRAFT_DEFAULT_VETO_THRESHOLD = DEFAULT_VETO_VOTES

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

/**
 * PURE: a veto rule as the vote count a redraft proposal stores. A count is capped at the teams that can
 * vote (all but the two in the trade); a percent is of all the teams, rounded up — the generic engine's
 * arithmetic, so a league reads the same either way.
 */
export function redraftVetoThreshold(rule: VetoRule, teamCount: number | null | undefined): number {
  const teams = typeof teamCount === 'number' && teamCount > 0 ? teamCount : null
  if (rule.mode === 'percent') return teams ? Math.max(1, Math.ceil((teams * rule.value) / 100)) : REDRAFT_DEFAULT_VETO_THRESHOLD
  return Math.max(1, teams ? Math.min(rule.value, Math.max(1, teams - 2)) : rule.value)
}

/** The league's settings and size, or null — a failed read keeps the default threshold, never the proposal. */
async function readLeagueVetoInputs(
  db: Partial<Pick<PrismaClient, 'league'>>,
  leagueId: string,
): Promise<{ settings: unknown; leagueSize: number | null } | null> {
  if (!db.league) return null
  try {
    return (await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueSize: true } })) ?? null
  } catch {
    return null
  }
}

export async function resolveRedraftTradeGovernance(
  db: Pick<PrismaClient, 'redraftLeagueExtendedSettings'> & Partial<Pick<PrismaClient, 'league'>>,
  leagueId: string,
): Promise<{ vetoMode: RedraftTradeVetoMode; vetoThreshold: number }> {
  const [settings, league] = await Promise.all([
    db.redraftLeagueExtendedSettings.findUnique({
      where: { leagueId },
      select: { commissionerTradeReviewType: true },
    }),
    readLeagueVetoInputs(db, leagueId),
  ])
  return {
    vetoMode: vetoModeFromReviewType(settings?.commissionerTradeReviewType),
    vetoThreshold: league ? redraftVetoThreshold(readVetoRule(league.settings), league.leagueSize) : REDRAFT_DEFAULT_VETO_THRESHOLD,
  }
}
