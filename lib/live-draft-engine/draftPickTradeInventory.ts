/**
 * Shared helpers for draft pick trade builder: upcoming owned picks and overall resolution.
 */

import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }

export type UpcomingPick = { overall: number; round: number; slot: number }

export function resolveOverallForRoundSlot(params: {
  round: number
  slot: number
  teamCount: number
  draftType: 'snake' | 'linear' | 'auction'
  thirdRoundReversal: boolean
}): number | null {
  const startOverall = (params.round - 1) * params.teamCount + 1
  const endOverall = params.round * params.teamCount
  for (let overall = startOverall; overall <= endOverall; overall += 1) {
    const derivedSlot = getSlotInRoundForOverall({
      overall,
      teamCount: params.teamCount,
      draftType: params.draftType,
      thirdRoundReversal: params.thirdRoundReversal,
    })
    if (derivedSlot === params.slot) return overall
  }
  return null
}

export function computeUpcomingOwnedPicks(params: {
  totalPicks: number
  pickedOverall: Set<number>
  teamCount: number
  draftType: 'snake' | 'linear' | 'auction'
  thirdRoundReversal: boolean
  slotOrder: SlotOrderEntry[]
  tradedPicks: TradedPickRecord[]
  ownerRosterId: string
}): UpcomingPick[] {
  const picks: UpcomingPick[] = []
  for (let overall = 1; overall <= params.totalPicks; overall += 1) {
    if (params.pickedOverall.has(overall)) continue
    const round = Math.ceil(overall / params.teamCount)
    const slot = getSlotInRoundForOverall({
      overall,
      teamCount: params.teamCount,
      draftType: params.draftType,
      thirdRoundReversal: params.thirdRoundReversal,
    })
    const owner = resolvePickOwner(round, slot, params.slotOrder, params.tradedPicks)
    if (owner?.rosterId === params.ownerRosterId) {
      picks.push({ overall, round, slot })
    }
  }
  return picks
}
