/**
 * IDP eligibility and lineup legality. NFL only.
 * Grouped slots accept grouped-eligible players; split slots enforce exact eligibility.
 * IDP FLEX accepts any IDP-eligible defender. No offensive player in IDP slots; no defender in offensive slots.
 * PROMPT 2/6.
 */

import { isIdpPosition as isIdpPositionFromMap, normalizeIdpPosition } from '@/lib/idp-kicker-values'
import type { IdpPositionMode } from './types'
import { IDP_GROUP_TO_SPLIT } from './types'

export { isIdpPositionFromMap as isIdpPosition }

/** Offensive position list (NFL). Used to block defenders from offensive slots. */
const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']

/** All IDP positions (split + grouped names used in slots). */
const IDP_SLOT_POSITIONS = ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB']

export function isOffensivePosition(position: string): boolean {
  return OFFENSIVE_POSITIONS.includes(position.toUpperCase())
}

/**
 * Get allowed positions for an IDP slot given position mode.
 * Grouped slots (DL, LB, DB): return [DE, DT] for DL, [CB, S] for DB, [LB] for LB.
 * Split slots (DE, DT, CB, S): return exact position.
 * IDP_FLEX: return all IDP-eligible positions (DE, DT, LB, CB, S).
 */
export function getAllowedPositionsForIdpSlot(
  slotName: string,
  positionMode: IdpPositionMode
): string[] {
  const slot = slotName.toUpperCase()
  if (slot === 'IDP_FLEX') return ['DE', 'DT', 'LB', 'CB', 'S']
  if (IDP_GROUP_TO_SPLIT[slot]) return IDP_GROUP_TO_SPLIT[slot]
  if (['DE', 'DT', 'LB', 'CB', 'S'].includes(slot)) return [slot]
  return []
}

/**
 * Check if a player position is eligible for an IDP slot.
 * Grouped slot: position must map to that family (e.g. DE/DT -> DL).
 * Split slot: position must match exactly (e.g. DE -> DE).
 */
export function isPositionEligibleForIdpSlot(
  playerPosition: string,
  slotName: string,
  positionMode: IdpPositionMode
): boolean {
  const pos = playerPosition.toUpperCase()
  const slot = slotName.toUpperCase()
  const allowed = getAllowedPositionsForIdpSlot(slot, positionMode)
  if (allowed.length === 0) return false
  const normalized = normalizeIdpPosition(pos) ?? pos
  if (allowed.includes(pos)) return true
  if (allowed.includes(normalized)) return true
  if (slot === 'DL' && (pos === 'DE' || pos === 'DT')) return true
  if (slot === 'DB' && (pos === 'CB' || pos === 'S' || pos === 'SS' || pos === 'FS')) return true
  if (slot === 'LB' && (pos === 'LB' || pos === 'ILB' || pos === 'OLB' || pos === 'MLB')) return true
  return false
}

/**
 * Lineup legality: only eligible defensive players may occupy IDP slots.
 * Returns { valid: false, reason } if player is offensive in IDP slot or defender in offensive slot.
 */
export function validateIdpLineupSlot(
  playerPosition: string,
  slotName: string,
  positionMode: IdpPositionMode
): { valid: boolean; reason?: string } {
  const pos = playerPosition.toUpperCase()
  const slot = slotName.toUpperCase()
  const idpSlots = ['DL', 'LB', 'DB', 'IDP_FLEX', 'DE', 'DT', 'CB', 'S']
  const isIdpSlot = idpSlots.includes(slot)
  const isDefender = isIdpPositionFromMap(pos) || IDP_SLOT_POSITIONS.some((p) => normalizeIdpPosition(pos) === p || pos === p)

  if (isIdpSlot) {
    if (isOffensivePosition(pos)) return { valid: false, reason: 'Offensive players cannot be placed in IDP slots.' }
    if (!isDefender) return { valid: false, reason: 'Only defensive players are eligible for IDP slots.' }
    if (!isPositionEligibleForIdpSlot(pos, slot, positionMode)) {
      return { valid: false, reason: `${pos} is not eligible for ${slot}.` }
    }
    return { valid: true }
  }

  if (OFFENSIVE_POSITIONS.includes(slot) || slot === 'FLEX' || slot === 'SUPERFLEX') {
    if (isDefender) return { valid: false, reason: 'Defensive players cannot be placed in offensive slots.' }
  }
  return { valid: true }
}
