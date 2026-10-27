/**
 * Pending trade offers expire when the trade deadline passes, and both sides are told — on a schedule,
 * for both trade engines.
 *
 * WHY A SWEEP. The deadline already refuses every acceptance (./tradeDeadlineWindow.ts), so an offer left
 * pending past it can never complete. Left alone it sat in both inboxes as a live offer whose Accept button
 * refuses every click until its own 48h `expiresAt` — and nothing on the AF engine acts on that either.
 *
 * WHAT EXPIRES. Only an offer nobody has accepted:
 *   - AF league engine: `AfLeagueTrade.status = 'pending'` (a multi-team offer with some acceptances is
 *     still pending — the trade needs every party, and the last party can no longer give it);
 *   - redraft proposals: `status = 'pending'` and `acceptedAt` null.
 * An accepted trade waiting on commissioner review, a league vote or a processing delay passed the gate
 * at acceptance and finishes its window — what Sleeper and ESPN do. Its sweep is
 * ./../redraft/tradeReviewWindowSweep.ts, untouched here.
 *
 * WHICH DEADLINE. Each engine's own reading, so the sweep can never expire an offer its engine would
 * still accept: the AF engine reads `resolveLeagueTradeSettings`, the redraft path `League.tradeDeadlineWeek`.
 * On the AF engine that is per OFFER: a picks-only offer in a league whose pick trades have their own
 * deadline (./pickTradeDeadline.ts) expires when that one passes, not the trade deadline.
 *
 * ⚠ BOUNDED AND CLAIMED. The host cron has a 60s budget, so leagues are capped per run (oldest offer
 * first); each expiry is a conditional claim, so a manager acting at the same instant wins or loses
 * cleanly, and the notice is idempotent per offer.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import {
  evaluateLeagueTradeDeadline,
  evaluateRedraftTradeDeadline,
  tradeDeadlinePassedMessage,
  type TradeDeadlineDeps,
} from './tradeDeadlineWindow'
import { isPicksOnlyTrade } from './pickTradeDeadline'

export const DEFAULT_DEADLINE_EXPIRY_LEAGUE_LIMIT = 40

export type DeadlineExpirySweepResult = {
  /** Leagues with a pending offer examined this run. */
  leaguesChecked: number
  /** Of those, leagues whose deadline has passed. */
  leaguesPastDeadline: number
  expiredAf: number
  expiredRedraft: number
  failures: { id: string; error: string }[]
}

export type DeadlineExpiryDeps = TradeDeadlineDeps & {
  db?: Pick<PrismaClient, 'afLeagueTrade' | 'redraftTradeProposal' | 'redraftTradeDecision' | 'redraftRoster' | '$transaction'>
  /** Injectable for tests. Production uses the AF engine's own expiry (claim, history, notice). */
  expireAf?: (input: { tradeId: string; leagueId: string; reason: string }) => Promise<boolean>
  notify?: (input: { userIds: string[]; leagueId: string; tradeId: string; reason: string }) => Promise<void>
  recordMarketEvent?: (input: { leagueId: string; seasonId: string; proposalId: string }) => Promise<void>
}

async function defaultRecordMarketEvent(input: { leagueId: string; seasonId: string; proposalId: string }): Promise<void> {
  const { recordRedraftTradeMarketEvent } = await import('@/lib/trade-market/redraftTradeMarketEvents')
  await recordRedraftTradeMarketEvent({
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    tradeProposalId: input.proposalId,
    eventType: 'proposal_expired',
    actorUserId: null,
  })
}

async function defaultExpireAf(input: { tradeId: string; leagueId: string; reason: string }): Promise<boolean> {
  const { expireAfLeagueTradeAtDeadline } = await import('@/lib/league-trade-engine/tradeService')
  return expireAfLeagueTradeAtDeadline(input)
}

async function defaultNotify(input: { userIds: string[]; leagueId: string; tradeId: string; reason: string }): Promise<void> {
  const { ingest, tradeEvent } = await import('@/lib/notification-engine')
  const event = tradeEvent({
    userIds: input.userIds,
    leagueId: input.leagueId,
    type: 'trade_rejected',
    tradeId: input.tradeId,
    title: 'Trade offer expired at the deadline',
    body: `${input.reason} Pending offers expire when trades close.`,
  })
  await ingest({ ...event, meta: { ...event.meta, idempotencyKey: `trade-deadline-expiry:${input.tradeId}` } })
}

export async function expirePendingOffersAtDeadline(
  opts: { leagueLimit?: number; deps?: DeadlineExpiryDeps } = {},
): Promise<DeadlineExpirySweepResult> {
  const deps = opts.deps ?? {}
  const db = deps.db ?? defaultPrisma
  const limit = Math.max(1, Math.min(opts.leagueLimit ?? DEFAULT_DEADLINE_EXPIRY_LEAGUE_LIMIT, 200))
  const result: DeadlineExpirySweepResult = { leaguesChecked: 0, leaguesPastDeadline: 0, expiredAf: 0, expiredRedraft: 0, failures: [] }

  const [afRows, redraftRows] = await Promise.all([
    db.afLeagueTrade.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      distinct: ['leagueId'],
      take: limit,
      select: { leagueId: true },
    }),
    db.redraftTradeProposal.findMany({
      where: { status: 'pending', acceptedAt: null },
      orderBy: { createdAt: 'asc' },
      distinct: ['leagueId'],
      take: limit,
      select: { leagueId: true },
    }),
  ])
  const afLeagues = new Set(afRows.map((r) => r.leagueId))
  const redraftLeagues = new Set(redraftRows.map((r) => r.leagueId))
  const leagueIds = [...new Set([...afLeagues, ...redraftLeagues])].slice(0, limit)

  for (const leagueId of leagueIds) {
    result.leaguesChecked += 1
    let pastDeadline = false
    try {
      if (afLeagues.has(leagueId)) {
        const trades = await evaluateLeagueTradeDeadline(leagueId, deps)
        // `scope: 'trades'` back means pick trades follow the trade deadline: one verdict for every offer.
        const picks = await evaluateLeagueTradeDeadline(leagueId, deps, { picksOnly: true })
        if (trades.passed || (picks.scope === 'picks' && picks.passed)) {
          const pending = await db.afLeagueTrade.findMany({
            where: { leagueId, status: 'pending' },
            select: { id: true, items: { select: { itemType: true } } },
          })
          for (const t of pending) {
            const verdict = picks.scope === 'picks' && isPicksOnlyTrade(t.items ?? []) ? picks : trades
            if (!verdict.passed) continue
            pastDeadline = true
            try {
              if (await (deps.expireAf ?? defaultExpireAf)({ tradeId: t.id, leagueId, reason: tradeDeadlinePassedMessage(verdict) })) result.expiredAf += 1
            } catch (e) {
              result.failures.push({ id: t.id, error: e instanceof Error ? e.message : String(e) })
            }
          }
        }
      }
      if (redraftLeagues.has(leagueId)) {
        const verdict = await evaluateRedraftTradeDeadline(leagueId, deps)
        if (verdict.passed) {
          pastDeadline = true
          result.expiredRedraft += await expireRedraftProposals(db, leagueId, tradeDeadlinePassedMessage(verdict), deps, result)
        }
      }
    } catch (e) {
      result.failures.push({ id: leagueId, error: e instanceof Error ? e.message : String(e) })
    }
    if (pastDeadline) result.leaguesPastDeadline += 1
  }
  return result
}

async function expireRedraftProposals(
  db: NonNullable<DeadlineExpiryDeps['db']>,
  leagueId: string,
  reason: string,
  deps: DeadlineExpiryDeps,
  result: DeadlineExpirySweepResult,
): Promise<number> {
  const pending = await db.redraftTradeProposal.findMany({
    where: { leagueId, status: 'pending', acceptedAt: null },
    select: { id: true, seasonId: true, proposerRosterId: true, receiverRosterId: true },
  })
  let expired = 0
  for (const proposal of pending) {
    try {
      // Same shape as the expiresAt sweep (lib/redraft/tradeProposalExpiry.ts): the claim and the decision
      // row commit together, so a proposal is never `expired` without its decision.
      const claimed = await db.$transaction(async (tx) => {
        const claim = await tx.redraftTradeProposal.updateMany({
          where: { id: proposal.id, status: 'pending', acceptedAt: null },
          // `reason` is the proposer's own note on the offer; the why lives on the decision row.
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
            decisionReason: reason,
            snapshot: {},
          },
          update: { decision: 'expired', decidedByUserId: null, decisionReason: reason },
        })
        return true
      })
      if (!claimed) continue
      expired += 1

      // Best-effort, after the commit: the market event and the notice must never undo an expiry.
      await (deps.recordMarketEvent ?? defaultRecordMarketEvent)({ leagueId, seasonId: proposal.seasonId, proposalId: proposal.id }).catch(() => {})
      const owners = await db.redraftRoster
        .findMany({ where: { id: { in: [proposal.proposerRosterId, proposal.receiverRosterId] } }, select: { ownerId: true } })
        .catch(() => [])
      const userIds = [...new Set(owners.map((o) => o.ownerId).filter((id) => typeof id === 'string' && id && !id.startsWith('orphan-') && !id.startsWith('open-slot-')))]
      if (userIds.length > 0) {
        await (deps.notify ?? defaultNotify)({ userIds, leagueId, tradeId: proposal.id, reason }).catch(() => {})
      }
    } catch (e) {
      result.failures.push({ id: proposal.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return expired
}
