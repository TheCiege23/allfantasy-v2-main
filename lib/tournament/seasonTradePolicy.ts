import 'server-only'
import type { Prisma } from '@prisma/client'
import { loadSeasonDraftContext } from './seasonDraftRuntime'
import { lockAndCheckSeasonRecovery, seasonRecoveryHeld } from './seasonRecoveryState'
import { seasonScoringId } from './seasonDraftHandoff'

export class SeasonTradeError extends Error {}

export async function readSeasonTradePolicy(db: Prisma.TransactionClient, leagueId: string, lock = false) {
  const context = await loadSeasonDraftContext(leagueId, db)
  if (!context) return null
  const held = lock ? await lockAndCheckSeasonRecovery(db, context.tournamentId) : await seasonRecoveryHeld(db, context.tournamentId)
  const [binding, league, scoring] = await Promise.all([
    db.tournamentLeague.findUnique({ where: { leagueId }, include: { round: true } }),
    db.league.findUnique({ where: { id: leagueId }, select: { locked: true, emergencyPaused: true } }),
    db.redraftSeason.findUnique({ where: { id: seasonScoringId(leagueId) }, select: { currentWeek: true, status: true } }),
  ])
  const { config } = context
  const rules = config.rules!
  const cut = rules.calendar.periods.find(period => period.number === binding?.round.weekEnd)
  const next = rules.calendar.periods.find(period => period.number === scoring?.currentWeek)
  if (held || !config.trades || context.stage === 3 || !league || league.locked || league.emergencyPaused ||
      binding?.status !== 'active' || binding.round.status !== 'active' || scoring?.status !== 'active' || !cut) {
    throw new SeasonTradeError('Trades are closed for this tournament league.')
  }
  const cutAt = Date.parse(cut.finalizesAt)
  return {
    config, seasonId: seasonScoringId(leagueId),
    acceptanceDeadline: cutAt - rules.tradeDeadlineHoursBeforeCut * 3_600_000,
    cutAt, reviewMs: rules.tradeReviewHours * 3_600_000,
    nextScoringAt: next && next.number <= binding.round.weekEnd ? Date.parse(next.startsAt) : null,
  }
}

export function seasonTradeOfferExpiry(policy: NonNullable<Awaited<ReturnType<typeof readSeasonTradePolicy>>>, expiresAt: Date, now: Date) {
  if (now.getTime() >= policy.acceptanceDeadline) throw new SeasonTradeError('The published tournament trade deadline has passed.')
  return new Date(Math.min(expiresAt.getTime(), policy.acceptanceDeadline))
}

export function assertSeasonTradeSettlement(
  policy: NonNullable<Awaited<ReturnType<typeof readSeasonTradePolicy>>>,
  proposal: { seasonId: string; expiresAt: Date | null; acceptedAt?: Date | null },
  now: Date,
) {
  if (proposal.seasonId !== policy.seasonId) throw new SeasonTradeError('Trade does not belong to the active tournament season.')
  const expires = proposal.expiresAt?.getTime() ?? Infinity
  const deadline = proposal.acceptedAt ? policy.cutAt : Math.min(expires, policy.acceptanceDeadline)
  if (now.getTime() >= deadline) {
    throw new SeasonTradeError('The tournament trade offer or review window expired.')
  }
}
