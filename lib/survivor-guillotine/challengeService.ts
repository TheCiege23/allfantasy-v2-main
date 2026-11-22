import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { resolveSGChallenge } from './seasonRules'
import { buildSGSchedule } from './config'
import type { SGConfig, SGTeam, SGMatchup } from './types'

export type SGChallengeReceipt = { kind: 'tribe_blowout_faab' | 'highest_score_idol' | 'highest_score_swap'; rosterIds: string[];
  amount: number; powerId?: string }

/** Idempotency belongs to the enclosing revision-checked chop transaction and its receipt. */
export async function settleSGChallenge(tx: Prisma.TransactionClient, leagueId: string, config: SGConfig,
  period: number, teams: SGTeam[], matchups: SGMatchup[], previous?: SGChallengeReceipt, tieWinnerId?: string): Promise<SGChallengeReceipt | undefined> {
  const challenge = config.rewardChallenges?.find(row => row.period === period)
  if (!challenge) return undefined
  const result = resolveSGChallenge(challenge, teams, matchups, tieWinnerId)
  if (previous && previous.kind === result.kind && previous.amount === result.amount &&
      [...previous.rosterIds].sort().join('\0') === [...result.rosterIds].sort().join('\0')) return previous
  if (previous?.kind === 'tribe_blowout_faab') {
    for (const rosterId of previous.rosterIds) {
      const roster = await tx.roster.findUniqueOrThrow({ where: { id: rosterId }, select: { redraftRosterId: true } })
      const debit = await tx.roster.updateMany({ where: { id: rosterId, faabRemaining: { gte: previous.amount } },
        data: { faabRemaining: { decrement: previous.amount } } })
      if (debit.count !== 1) throw new Error('Reward FAAB has been spent; reconcile the challenge with the commissioner before advancing.')
      if (roster.redraftRosterId) {
        const mirrored = await tx.redraftRoster.updateMany({ where: { id: roster.redraftRosterId, faabBalance: { gte: previous.amount } },
          data: { faabBalance: { decrement: previous.amount } } })
        if (mirrored.count !== 1) throw new Error('Mirrored reward FAAB needs commissioner reconciliation.')
      }
    }
  } else if (previous?.powerId) {
    const removed = await tx.survivorGuillotinePower.updateMany({ where: { id: previous.powerId, leagueId, status: 'held' },
      data: { status: 'expired' } })
    if (removed.count !== 1) throw new Error('The corrected reward idol was already played; commissioner reconciliation is required.')
  }
  if (result.kind === 'tribe_blowout_faab') {
    for (const rosterId of result.rosterIds) {
      const roster = await tx.roster.findUniqueOrThrow({ where: { id: rosterId }, select: { redraftRosterId: true } })
      await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: result.amount } } })
      if (roster.redraftRosterId) await tx.redraftRoster.update({ where: { id: roster.redraftRosterId },
        data: { faabBalance: { increment: result.amount } } })
    }
    return result
  }
  const owner = await tx.leagueTeam.findFirst({ where: { leagueId, externalId: result.rosterIds[0] },
    select: { claimedByUserId: true } })
  if (!owner?.claimedByUserId) throw new Error('The idol challenge winner must have a claimed manager account.')
  const powerId = randomUUID()
  const merge = buildSGSchedule(config).periods.find(p => p.mode === 'merged')!.period
  await tx.survivorGuillotinePower.create({ data: { id: powerId, leagueId, kind: result.kind === 'highest_score_swap' ? 'tribe_swap' : 'personal_immunity',
    // awardPeriod is unique per league and reserved for the concealed reward stream.
    binding: 'manager', ownerUserId: owner.claimedByUserId, source: 'public_challenge', activationPeriod: period + 1,
    expiresAfterPeriod: merge - 1 } })
  return { ...result, powerId }
}
