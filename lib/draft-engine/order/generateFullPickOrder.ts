/**
 * Deterministic full pick order for snake / linear / 3RR (no auction).
 * Traded picks are applied by consumers via `resolvePickOwner` — this is the structural order.
 */

import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'
import {
  formatPickLabel,
  getRosterIdForOverall,
  getSlotInRoundForOverall,
} from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftType } from '@/lib/live-draft-engine/types'

type PlannedPickSlot = {
  overall: number
  round: number
  slot: number
  pickLabel: string
  rosterId: string
  displayName: string
}

export function generateFullPickOrder(params: {
  teamCount: number
  rounds: number
  draftType: DraftType
  thirdRoundReversal: boolean
  slotOrder: SlotOrderEntry[]
}): PlannedPickSlot[] {
  const { teamCount, rounds, draftType, thirdRoundReversal, slotOrder } = params
  if (teamCount < 2 || rounds < 1) return []
  if (draftType === 'auction') return []

  const total = rounds * teamCount
  const out: PlannedPickSlot[] = []
  for (let overall = 1; overall <= total; overall += 1) {
    const round = Math.ceil(overall / teamCount)
    const slot =
      draftType === 'linear'
        ? ((overall - 1) % teamCount) + 1
        : getSlotInRoundForOverall({ overall, teamCount, draftType, thirdRoundReversal })
    const owner = getRosterIdForOverall(overall, teamCount, draftType, thirdRoundReversal, slotOrder)
    if (!owner) continue
    out.push({
      overall,
      round,
      slot,
      pickLabel: formatPickLabel(overall, teamCount),
      rosterId: owner.rosterId,
      displayName: owner.displayName,
    })
  }
  return out
}
