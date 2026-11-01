import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

/**
 * A pick FORFEITED as a penalty (lib/integrity/tankingPenaltyService.ts) is skipped when the draft
 * reaches it: the same `(Skipped)` / `SKIP` row the commissioner's skip writes, so the board moves on
 * and no roster receives a player. Forfeited rows for the draft's season are tagged with the session
 * at creation (consumeNativeFuturePicksForDraft), so this reads only this draft's forfeits.
 *
 * A pick is identified by its round and its ORIGINAL team — the slot it belongs to in the draft order
 * — whoever holds it now.
 */
export const FORFEITED_PICK_NAME = '(Forfeited)'

/** `round:originalRosterId` keys of the forfeited picks in a draft. Pure. */
export function forfeitedKey(round: number, originalRosterId: string): string {
  return `${round}:${originalRosterId}`
}

/**
 * Skip every forfeited pick at the head of the board, then stop at the first pick a team may make.
 * Called after each submitted pick and when a draft starts. Returns how many picks it skipped.
 * Bounded, and a failed skip stops the loop — the clock then simply sits on the pick, as it would
 * without this.
 */
export async function skipForfeitedPicksOnClock(
  leagueId: string,
  submit: (input: { leagueId: string; playerName: string; position: string; team: null; byeWeek: null; source: 'commissioner'; expectedOverall: number; pickMetadata: Record<string, unknown> }) => Promise<{ success: boolean }>,
): Promise<number> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true },
  })
  if (!session || session.status !== 'in_progress') return 0
  const rows = await prisma.futureDraftPick.findMany({
    where: { leagueId, status: 'forfeited', usedInDraftSessionId: session.id },
    select: { round: true, originalRosterId: true },
  })
  if (rows.length === 0) return 0
  const forfeited = new Set(rows.map((r) => forfeitedKey(r.round, r.originalRosterId)))

  let skipped = 0
  for (let guard = 0; guard < rows.length; guard++) {
    const s = await prisma.draftSession.findUnique({
      where: { id: session.id },
      select: {
        status: true,
        rounds: true,
        teamCount: true,
        draftType: true,
        thirdRoundReversal: true,
        slotOrder: true,
        picks: { select: { overall: true, playerName: true, position: true, pickMetadata: true }, orderBy: { overall: 'asc' } },
      },
    })
    if (!s || s.status !== 'in_progress' || s.draftType === 'auction') break
    // `rosterId` on the clock is the SLOT's team — the pick's original owner; trades apply elsewhere.
    const current = resolveCurrentOnTheClock({
      totalPicks: s.rounds * s.teamCount,
      picks: s.picks,
      teamCount: s.teamCount,
      draftType: s.draftType as 'snake' | 'linear',
      thirdRoundReversal: s.thirdRoundReversal,
      slotOrder: (Array.isArray(s.slotOrder) ? s.slotOrder : []) as unknown as SlotOrderEntry[],
    })
    if (!current || !forfeited.has(forfeitedKey(current.round, current.rosterId))) break
    const result = await submit({
      leagueId,
      playerName: FORFEITED_PICK_NAME,
      position: 'SKIP',
      team: null,
      byeWeek: null,
      source: 'commissioner',
      expectedOverall: current.overall,
      pickMetadata: { forfeited: true, reason: 'Forfeited as a league penalty', round: current.round, originalRosterId: current.rosterId },
    })
    if (!result.success) break
    skipped += 1
  }
  return skipped
}
