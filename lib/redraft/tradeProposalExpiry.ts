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
    where: { status: 'pending', expiresAt: { lt: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true, leagueId: true, seasonId: true, proposerRosterId: true },
  })

  const result: RedraftTradeExpirySweepResult = { due: due.length, expired: 0, skipped: 0, failures: [] }

  for (const proposal of due) {
    try {
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.redraftTradeProposal.updateMany({
          where: { id: proposal.id, status: 'pending', expiresAt: { lt: now } },
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
