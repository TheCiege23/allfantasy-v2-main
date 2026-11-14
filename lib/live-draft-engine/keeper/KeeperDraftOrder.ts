/**
 * Map keeper round-cost to (round, slot, overall) for draft board.
 * Uses snake/3RR from DraftOrderService.
 */

import type { DraftType } from '../types'
import type { SlotOrderEntry } from '../types'
import type { KeeperLock, KeeperSelection } from './types'
import { resolvePickOwner } from '../PickOwnershipResolver'
import type { TradedPickRecord } from '../types'

/**
 * Get (round, slot, overall) for a given roster's pick in a given round (snake/3RR).
 */
export function getRoundSlotForRoster(
  rosterId: string,
  round: number,
  teamCount: number,
  draftType: DraftType,
  thirdRoundReversal: boolean,
  slotOrder: SlotOrderEntry[]
): { overall: number; slot: number } | null {
  const slotEntry = slotOrder.find((e) => e.rosterId === rosterId)
  const rosterSlot = slotEntry?.slot ?? (slotOrder.findIndex((e) => e.rosterId === rosterId) + 1)
  if (rosterSlot <= 0 || rosterSlot > teamCount) return null

  const isReversed =
    draftType === 'snake' &&
    (thirdRoundReversal
      ? round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
      : round % 2 === 0)
  const pickInRound = isReversed ? teamCount - rosterSlot + 1 : rosterSlot
  const overall = (round - 1) * teamCount + pickInRound
  return { overall, slot: rosterSlot }
}

/**
 * Build keeper locks for draft board: for each keeper selection, resolve (round, slot) and owner (for traded picks).
 */
export function buildKeeperLocks(
  keeperSelections: KeeperSelection[],
  slotOrder: SlotOrderEntry[],
  tradedPicks: TradedPickRecord[],
  teamCount: number,
  rounds: number,
  draftType: DraftType,
  thirdRoundReversal: boolean
): KeeperLock[] {
  const locks: KeeperLock[] = []
  for (const sel of keeperSelections) {
    const roundSlot = getRoundSlotForRoster(
      sel.rosterId,
      sel.roundCost,
      teamCount,
      draftType,
      thirdRoundReversal,
      slotOrder
    )
    if (!roundSlot || sel.roundCost > rounds) continue

    const resolved = resolvePickOwner(sel.roundCost, roundSlot.slot, slotOrder, tradedPicks)
    const displayName = resolved?.displayName ?? slotOrder.find((e) => e.rosterId === sel.rosterId)?.displayName ?? null
    locks.push({
      round: sel.roundCost,
      slot: roundSlot.slot,
      overall: roundSlot.overall,
      rosterId: resolved?.rosterId ?? sel.rosterId,
      displayName,
      playerName: sel.playerName,
      position: sel.position,
      team: sel.team,
      playerId: sel.playerId,
      isKeeper: true,
    })
  }
  return locks
}
