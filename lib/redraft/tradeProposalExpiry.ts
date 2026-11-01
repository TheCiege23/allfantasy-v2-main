/**
 * Expire redraft trade proposals whose `expiresAt` has passed, on a schedule.
 *
 * 🛑 WHAT WAS BROKEN (audit #25). A redraft proposal carries `expiresAt` (48h by default), but nothing ever
 * acted on it. `/api/redraft/trade-votes` marks a proposal `expired` only when somebody tries to act on it
 * after the deadline — expiry was LAZY. So:
 *
 *   - a dead offer stayed `pending` in the receiver's inbox and the league's vote queue indefinitely
 *   - a league-vote trade that never reached either threshold never resolved at all
 *   - an accepted trade awaiting commissioner review or a league vote kept counting down, and died silently
 *     the next time anyone clicked
 *
 * This applies the SAME rule the route already applies — `status === 'pending' && expiresAt < now` →
 * `expired` — without waiting for a click. It does not invent a new governance outcome: in particular, an
 * accepted trade still waiting on review expires here exactly as it already did on the next action.
 *
 * ⚠ CLAIMED CONDITIONALLY, AND THE DECISION ROW WRITTEN IN THE SAME TRANSACTION. A manager accepting at the
 * same instant the sweep runs must win or lose cleanly: the claim only matches a row that is still pending
 * and still past its deadline, and a proposal is never left `expired` without its decision row. The market
 * event and learning event follow best-effort, as they do on the lazy path; the market event is idempotent
 * per (proposal, eventType), so a click and a sweep cannot both record one.
 *
 * ⚠ THE SCHEDULED CALLER IS `/api/redraft/waiver-process` (hourly), NOT `trade-grade-notify`. That route
 * already hosts the generic scheduled-trade processor, but measures p99 359s against its own 300s
 * maxDuration (scripts/cron-fast-tier-loop.mjs). The redraft waiver cron is the redraft domain's own
 * hourly job, bounded, and review windows are measured in days, so hourly granularity is plenty.
 */
import { prisma } from '@/lib/prisma'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'
import {
  MULTI_TEAM_TRADE_EXPIRED_TITLE,
  multiTeamTradeExpiredBody,
  notifyMultiTeamTradeOutcome,
} from '@/lib/redraft/multiTeamTradeNotices'
import { isMultiTeamTrade } from '@/lib/redraft/tradeParticipants'

/** Default cap per run. The host cron has a 60s budget and its own waiver work to do. */
export const DEFAULT_TRADE_EXPIRY_LIMIT = 25

export const SWEEP_EXPIRY_REASON = 'Proposal expired without action'

export type RedraftTradeExpirySweepResult = {
  /** Pending proposals found past their deadline this run (bounded by `limit`). */
  due: number
  /** Proposals this run moved to `expired`. */
  expired: number
  /** Due proposals someone acted on between the read and the claim — left alone. */
  skipped: number
  /** One entry per proposal that threw. The sweep continues past each. */
  failures: { proposalId: string; error: string }[]
}

export async function expireDueRedraftTradeProposals(opts?: {
  limit?: number
  /** Injectable for tests. Production passes nothing. */
  now?: Date
}): Promise<RedraftTradeExpirySweepResult> {
  const now = opts?.now ?? new Date()
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_TRADE_EXPIRY_LIMIT, 200))

  // Oldest deadline first, so a backlog drains in order across runs.
  const due = await prisma.redraftTradeProposal.findMany({
    // An ACCEPTED trade past its deadline is a review window that ended with no veto: it goes through,
    // by ./tradeReviewWindowSweep.ts, never expires here.
    where: { status: 'pending', acceptedAt: null, expiresAt: { lt: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: {
      id: true,
      leagueId: true,
      seasonId: true,
      proposerRosterId: true,
      receiverRosterId: true,
      additionalRosterIds: true,
      acceptedRosterIds: true,
    },
  })

  const result: RedraftTradeExpirySweepResult = { due: due.length, expired: 0, skipped: 0, failures: [] }

  for (const proposal of due) {
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.redraftTradeProposal.updateMany({
          where: { id: proposal.id, status: 'pending', acceptedAt: null, expiresAt: { lt: now } },
          data: { status: 'expired' },
        })
        if (claim.count === 0) return false
        await tx.redraftTradeDecision.upsert({
          where: { proposalId: proposal.id },
          create: {
            id: crypto.randomUUID(),
            proposalId: proposal.id,
            decision: 'expired',
            decidedByUserId: null,
            decisionReason: SWEEP_EXPIRY_REASON,
            snapshot: {},
          },
          update: { decision: 'expired', decidedByUserId: null, decisionReason: SWEEP_EXPIRY_REASON },
        })
        return true
      })

      if (!claimed) {
        result.skipped += 1
        continue
      }
      result.expired += 1

      /*
       * 🛑 TELL THE TEAMS, EXACTLY AS THE LAZY EXPIRY IN app/api/redraft/trade-votes DOES — before the
       * market and learning events, so neither failing can leave a dead offer unannounced.
       *   two teams    the DM offer card's `expired` line, which both managers see in their thread
       *   multi-team   one in-app notice to every team, every team named, under the SAME event key
       *                (`expired` → `redraft_trade:<id>:expired`), so a click and a sweep are one notice
       * No actor: the schedule expired it, nobody chose to. Both calls are best-effort and never reject.
       * The proposer's `trade_expired` learning event below is unchanged; it is a record, not a notice.
       */
      queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'expired' })
      if (isMultiTeamTrade(proposal)) {
        await notifyMultiTeamTradeOutcome({
          proposal,
          key: 'expired',
          title: MULTI_TEAM_TRADE_EXPIRED_TITLE,
          body: ({ teams }) => multiTeamTradeExpiredBody(teams),
        })
      }

      await recordRedraftTradeMarketEvent({
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        tradeProposalId: proposal.id,
        eventType: 'proposal_expired',
        actorUserId: null,
      })

      const proposer = await prisma.redraftRoster
        .findFirst({ where: { id: proposal.proposerRosterId }, select: { ownerId: true } })
        .catch(() => null)
      if (proposer?.ownerId) {
        const sport = await resolveLeagueSport(proposal.leagueId).catch(() => 'NFL')
        await recordAfLearningEvent({
          eventType: 'trade_expired',
          sport,
          leagueId: proposal.leagueId,
          userId: proposer.ownerId,
          source: 'redraft_trade_proposal',
          payload: { proposalId: proposal.id, expiredBy: 'schedule' },
        }).catch(() => {})
      }
    } catch (e) {
      result.failures.push({ proposalId: proposal.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return result
}
