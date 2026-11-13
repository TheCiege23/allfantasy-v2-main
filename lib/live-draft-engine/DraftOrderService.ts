/**
 * Draft order: slot in round from overall index.
 * Handles snake and third-round reversal (3RR).
 */

import type { DraftType, SlotOrderEntry } from './types'

interface DraftOrderParams {
  overall: number
  teamCount: number
  draftType: DraftType
  thirdRoundReversal: boolean
}

/**
 * Get 1-based slot in round for a given overall pick (1-based).
 * Snake: even rounds reverse (12,11,...,1). 3RR: round 2 and 3 reversed, then normal snake from round 4 (4 norm, 5 rev, 6 norm, ...).
 */
export function getSlotInRoundForOverall(params: DraftOrderParams): number {
  const { overall, teamCount, draftType, thirdRoundReversal } = params
  const round = Math.ceil(overall / teamCount)
  let slot1Based = ((overall - 1) % teamCount) + 1
  const isReversed =
    draftType === 'snake' &&
    (thirdRoundReversal
      ? round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
      : round % 2 === 0)
  if (isReversed) {
    slot1Based = teamCount - slot1Based + 1
  }
  return slot1Based
}

/**
 * Format pick label (e.g. 1.01, 2.12).
 */
export function formatPickLabel(overall: number, teamCount: number): string {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  return `${round}.${pickInRound.toString().padStart(2, '0')}`
}

/**
 * Get rosterId for the manager who has the given overall pick from slot order.
 */
export function getRosterIdForOverall(
  overall: number,
  teamCount: number,
  draftType: DraftType,
  thirdRoundReversal: boolean,
  slotOrder: { slot: number; rosterId: string; displayName: string }[]
): { rosterId: string; displayName: string } | null {
  const slot = getSlotInRoundForOverall({ overall, teamCount, draftType, thirdRoundReversal })
  const entry = slotOrder.find((e) => e.slot === slot)
  return entry ? { rosterId: entry.rosterId, displayName: entry.displayName } : null
}

/** Next `count` pick owners after `nextOverall` (1-based overall index). Used by Live Draft Brain + on-deck UI. */
export function getUpcomingPickOwners(
  nextOverall: number,
  count: number,
  teamCount: number,
  draftType: DraftType,
  thirdRoundReversal: boolean,
  slotOrder: SlotOrderEntry[],
  totalPicks: number
): Array<{ rosterId: string; displayName: string; slot: number }> {
  const out: Array<{ rosterId: string; displayName: string; slot: number }> = []
  for (let k = 0; k < count; k += 1) {
    const overall = nextOverall + k
    if (overall > totalPicks) break
    const slot = getSlotInRoundForOverall({ overall, teamCount, draftType, thirdRoundReversal })
    const r = getRosterIdForOverall(overall, teamCount, draftType, thirdRoundReversal, slotOrder)
    if (r) out.push({ ...r, slot })
  }
  return out
}
