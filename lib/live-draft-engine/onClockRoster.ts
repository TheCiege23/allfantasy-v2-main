/**
 * The roster on the clock in a league's live draft, or null when no draft is running.
 *
 * A small read of its own (not the full session snapshot) so "which of my teams is up" can be answered
 * for a manager who runs several without building the whole board. Traded picks are honoured: the team
 * that owns the pick is the one on the clock.
 */
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveCurrentOnTheClock } from './CurrentOnTheClockResolver'
import { applyTradedOwnerToCurrentPick } from './PickOwnershipResolver'
import type { SlotOrderEntry, TradedPickRecord } from './types'

export async function resolveOnClockRosterIdForLeague(leagueId: string): Promise<string | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, status: { in: ['in_progress', 'paused'] } },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      draftType: true, rounds: true, teamCount: true, thirdRoundReversal: true, slotOrder: true, tradedPicks: true,
      picks: { select: { overall: true, playerName: true, position: true, pickMetadata: true } },
    },
  })
  if (!session) return null
  const slotOrder = (Array.isArray(session.slotOrder) ? session.slotOrder : []) as unknown as SlotOrderEntry[]
  const tradedPicks = (Array.isArray(session.tradedPicks) ? session.tradedPicks : []) as unknown as TradedPickRecord[]
  const current = applyTradedOwnerToCurrentPick(
    resolveCurrentOnTheClock({
      totalPicks: session.rounds * session.teamCount,
      picks: session.picks,
      teamCount: session.teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    }),
    slotOrder,
    tradedPicks,
  )
  return current?.rosterId ?? null
}

/**
 * Which of a manager's teams the draft room is about: the one named, else the one on the clock, else
 * the one they last switched to, else their first. Pure, so the order is testable.
 */
export function chooseDraftRosterId(input: {
  rosterIds: readonly string[]
  requestedRosterId?: string | null
  onClockRosterId?: string | null
  rememberedRosterIds?: readonly string[]
}): string | null {
  const mine = input.rosterIds
  if (mine.length === 0) return null
  const requested = String(input.requestedRosterId ?? '').trim()
  if (requested && mine.includes(requested)) return requested
  if (mine.length === 1) return mine[0]!
  if (input.onClockRosterId && mine.includes(input.onClockRosterId)) return input.onClockRosterId
  const remembered = (input.rememberedRosterIds ?? []).find((id) => mine.includes(id))
  return remembered ?? mine[0]!
}
