import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertWaiverClaimEligibility } from './transaction-eligibility'
import { addPlayerToRosterData, removePlayerFromRosterData, getRosterPlayerIds } from './roster-utils'

/**
 * Immediate free-agent add/drop (Step 3B).
 *
 * Performs a SINGLE-ROSTER add/drop directly — it does NOT invoke the league-wide waiver
 * processor, so it never disturbs other teams' pending claims. It reuses the existing eligibility
 * gate (roster limits, locks, availability, drop legality) and writes the same `waiverTransaction`
 * row the processor writes, so the move appears in the existing history/transaction feed.
 *
 * Caller is responsible for deciding whether the league allows an immediate add (FCFS or
 * instant-free-agent). If the player must go through waivers, do not call this — return
 * WAIVER_REQUIRED upstream.
 */
export interface ImmediateAddDropResult {
  ok: true
  transaction: {
    id: string
    addPlayerId: string
    dropPlayerId: string | null
    faabSpent: number | null
    processedAt: string
    source: 'free_agent'
  }
  rosterId: string
  rosterPlayerIds: string[]
}

export async function executeImmediateAddDrop(
  leagueId: string,
  rosterId: string,
  input: { addPlayerId: string; dropPlayerId?: string | null },
): Promise<ImmediateAddDropResult> {
  const addPlayerId = String(input.addPlayerId)
  const dropPlayerId = input.dropPlayerId ? String(input.dropPlayerId) : null

  // Validate first (throws on any illegal state; the route maps the message to a code).
  await assertWaiverClaimEligibility({
    leagueId,
    rosterId,
    addPlayerId,
    dropPlayerId,
    faabBid: null,
    claimMetadata: { source: 'free_agent_immediate' },
  })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const roster = await tx.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, playerData: true } })
    if (!roster) throw new Error('Roster not found or does not belong to this league.')

    // Re-check inside the transaction to avoid a race that double-adds or drops a missing player.
    const currentIds = getRosterPlayerIds(roster.playerData)
    if (currentIds.includes(addPlayerId)) throw new Error('This player is already on your roster.')
    if (dropPlayerId && !currentIds.includes(dropPlayerId)) throw new Error('Drop player is not on your roster.')

    let nextData: unknown = roster.playerData
    if (dropPlayerId) nextData = removePlayerFromRosterData(nextData, dropPlayerId)
    nextData = addPlayerToRosterData(nextData, addPlayerId)

    await tx.roster.update({ where: { id: rosterId }, data: { playerData: nextData as Prisma.InputJsonValue } })

    const txnRow = await tx.waiverTransaction.create({
      data: {
        leagueId,
        sportType: league?.sport ?? null,
        rosterId,
        claimId: null,
        waiverRunId: null,
        addPlayerId,
        dropPlayerId,
        faabSpent: null,
      },
      select: { id: true, addPlayerId: true, dropPlayerId: true, faabSpent: true, processedAt: true },
    })

    return {
      ok: true as const,
      transaction: {
        id: txnRow.id,
        addPlayerId: txnRow.addPlayerId,
        dropPlayerId: txnRow.dropPlayerId,
        faabSpent: txnRow.faabSpent,
        processedAt: (txnRow.processedAt ?? new Date()).toISOString(),
        source: 'free_agent' as const,
      },
      rosterId,
      rosterPlayerIds: getRosterPlayerIds(nextData),
    }
  })
}
