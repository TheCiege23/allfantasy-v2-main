/**
 * Resolve current owner of a pick slot (round, slot) for traded-pick support.
 * If league uses Sleeper, traded_picks API can be used; otherwise use internal mapping.
 * When no trade: use slot order. When traded: return new owner and optional UI metadata.
 */

import type { TradedPickMeta, TradedPickRecord } from './types'

export interface ResolvedPickOwner {
  rosterId: string
  displayName: string
  tradedPickMeta: TradedPickMeta | null
}

/**
 * Resolve owner for a given (round, slot) and optional traded-picks list.
 * If tradedPicks contains an entry for this round/slot, return new owner + metadata.
 * Otherwise return null for tradedPickMeta (no color/red name override).
 */
export function resolvePickOwner(
  round: number,
  slot: number,
  slotOrder: { slot: number; rosterId: string; displayName: string }[],
  tradedPicks: TradedPickRecord[] = []
): ResolvedPickOwner | null {
  const slotEntry = slotOrder.find((e) => e.slot === slot)
  if (!slotEntry) return null

  // If multiple accepted trades exist for the same pick, the latest accepted record wins.
  const traded = [...tradedPicks]
    .reverse()
    .find((t) => t.round === round && t.originalRosterId === slotEntry.rosterId)
  if (traded) {
    return {
      rosterId: traded.newRosterId,
      displayName: traded.newOwnerName,
      tradedPickMeta: {
        originalRosterId: traded.originalRosterId,
        previousOwnerName: traded.previousOwnerName,
        newOwnerName: traded.newOwnerName,
        // UI decides whether to display red owner labels via settings.
        showNewOwnerInRed: false,
        tintColor: undefined,
      },
    }
  }

  return {
    rosterId: slotEntry.rosterId,
    displayName: slotEntry.displayName,
    tradedPickMeta: null,
  }
}

/**
 * Apply optional UI settings to tradedPickMeta (tint color for "traded pick color mode").
 * Caller can set tintColor from manager color when setting is on; leave null when off.
 */
export function applyTradedPickUIMeta(
  meta: TradedPickMeta | null,
  options: { tintColor?: string; showNewOwnerInRed?: boolean }
): TradedPickMeta | null {
  if (!meta) return null
  return {
    ...meta,
    ...(options.tintColor != null && { tintColor: options.tintColor }),
    ...(options.showNewOwnerInRed != null && { showNewOwnerInRed: options.showNewOwnerInRed }),
  }
}

/**
 * The on-the-clock pick with a traded slot's NEW owner applied — the one rule the server snapshot
 * (`buildSessionSnapshot`) and the client's repair of a snapshot that arrived without `currentPick`
 * (`repairDraftSessionAuthority`) share. Before 2026-10-26 the client repair inferred the clock from
 * `slotOrder` alone, so after a pick trade it could put the ORIGINAL owner back on the clock.
 */
export function applyTradedOwnerToCurrentPick<T extends { round: number; slot: number; rosterId: string; displayName: string }>(
  currentPick: T | null,
  slotOrder: { slot: number; rosterId: string; displayName: string }[],
  tradedPicks: TradedPickRecord[] | null | undefined,
): T | null {
  if (!currentPick || !tradedPicks?.length) return currentPick
  const resolved = resolvePickOwner(currentPick.round, currentPick.slot, slotOrder, tradedPicks)
  return resolved ? { ...currentPick, rosterId: resolved.rosterId, displayName: resolved.displayName } : currentPick
}
