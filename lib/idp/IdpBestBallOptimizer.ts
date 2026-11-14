/**
 * [NEW] lib/idp/IdpBestBallOptimizer.ts
 * Greedy lineup optimizer for IDP best-ball leagues.
 * Builds the highest-scoring legal lineup respecting all offensive + IDP slot constraints.
 * Deterministic: no AI involvement.
 */

import { isPositionEligibleForIdpSlot } from './IDPEligibility'
import { getIdpLeagueConfig, getRosterDefaultsForIdpLeague } from './IDPLeagueConfig'
import type { IdpPositionMode } from './types'

export interface PlayerScore {
  playerId: string
  position: string
  points: number
}

export interface OptimalLineup {
  starters: Array<{ playerId: string; slotName: string; points: number }>
  bench: Array<{ playerId: string; position: string; points: number }>
  totalPoints: number
}

const OFFENSIVE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
const IDP_POSITION_SET = new Set(['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'DB', 'ILB', 'OLB', 'SS', 'FS'])

function isIdpPosition(pos: string): boolean {
  return IDP_POSITION_SET.has(pos.toUpperCase())
}

function isOffensivePosition(pos: string): boolean {
  return OFFENSIVE_POSITIONS.has(pos.toUpperCase())
}

/** Check if a player's position can fill an offensive FLEX slot. */
function canFillOffensiveFlex(pos: string): boolean {
  const p = pos.toUpperCase()
  return p === 'RB' || p === 'WR' || p === 'TE'
}

/**
 * Build optimal best-ball lineup for one roster in one week.
 * Uses greedy assignment: sort all players by points descending, assign to best available slot.
 */
export function optimizeIdpBestBallLineup(
  players: PlayerScore[],
  offenseSlots: Array<{ slotName: string; count: number }>,
  idpSlots: Array<{ slotName: string; count: number }>,
  positionMode: IdpPositionMode
): OptimalLineup {
  // Build slot pool: each slot instance gets a unique key
  const openSlots: Array<{ key: string; slotName: string; type: 'offense' | 'idp' }> = []

  for (const slot of offenseSlots) {
    for (let i = 0; i < slot.count; i++) {
      openSlots.push({ key: `${slot.slotName}_${i}`, slotName: slot.slotName, type: 'offense' })
    }
  }
  for (const slot of idpSlots) {
    for (let i = 0; i < slot.count; i++) {
      openSlots.push({ key: `${slot.slotName}_${i}`, slotName: slot.slotName, type: 'idp' })
    }
  }

  // Sort players by points descending (greedy)
  const sorted = [...players].sort((a, b) => b.points - a.points)

  const starters: OptimalLineup['starters'] = []
  const usedSlotKeys = new Set<string>()
  const assignedPlayerIds = new Set<string>()

  for (const player of sorted) {
    if (assignedPlayerIds.has(player.playerId)) continue

    const pos = player.position.toUpperCase()
    const isIdp = isIdpPosition(pos)
    const isOff = isOffensivePosition(pos)

    // Try to find a matching open slot
    let assigned = false

    // First pass: try exact position match
    for (const slot of openSlots) {
      if (usedSlotKeys.has(slot.key)) continue

      if (isIdp && slot.type === 'idp') {
        if (isPositionEligibleForIdpSlot(pos, slot.slotName, positionMode)) {
          starters.push({ playerId: player.playerId, slotName: slot.slotName, points: player.points })
          usedSlotKeys.add(slot.key)
          assignedPlayerIds.add(player.playerId)
          assigned = true
          break
        }
      } else if (isOff && slot.type === 'offense') {
        const slotUpper = slot.slotName.toUpperCase()
        if (slotUpper === pos) {
          starters.push({ playerId: player.playerId, slotName: slot.slotName, points: player.points })
          usedSlotKeys.add(slot.key)
          assignedPlayerIds.add(player.playerId)
          assigned = true
          break
        }
      }
    }

    // Second pass: try FLEX slots
    if (!assigned) {
      for (const slot of openSlots) {
        if (usedSlotKeys.has(slot.key)) continue
        const slotUpper = slot.slotName.toUpperCase()

        if (isIdp && slotUpper === 'IDP_FLEX' && slot.type === 'idp') {
          starters.push({ playerId: player.playerId, slotName: 'IDP_FLEX', points: player.points })
          usedSlotKeys.add(slot.key)
          assignedPlayerIds.add(player.playerId)
          assigned = true
          break
        }

        if (isOff && slotUpper === 'FLEX' && slot.type === 'offense' && canFillOffensiveFlex(pos)) {
          starters.push({ playerId: player.playerId, slotName: 'FLEX', points: player.points })
          usedSlotKeys.add(slot.key)
          assignedPlayerIds.add(player.playerId)
          assigned = true
          break
        }
      }
    }
  }

  // Remaining unassigned players go to bench
  const bench = sorted
    .filter((p) => !assignedPlayerIds.has(p.playerId))
    .map((p) => ({ playerId: p.playerId, position: p.position, points: p.points }))

  const totalPoints = starters.reduce((sum, s) => sum + s.points, 0)

  return { starters, bench, totalPoints }
}

/**
 * Build optimal lineup for a league's roster using league config.
 * Fetches slot configuration from DB.
 */
export async function optimizeForLeagueRoster(
  leagueId: string,
  players: PlayerScore[]
): Promise<OptimalLineup> {
  const config = await getIdpLeagueConfig(leagueId)
  if (!config) {
    // Not an IDP league — return empty
    return { starters: [], bench: players.map((p) => ({ playerId: p.playerId, position: p.position, points: p.points })), totalPoints: 0 }
  }

  const rosterDefaults = await getRosterDefaultsForIdpLeague(leagueId)
  const positionMode = config.positionMode as IdpPositionMode

  // Build slot arrays from roster defaults
  const offenseSlots: Array<{ slotName: string; count: number }> = []
  const idpSlots: Array<{ slotName: string; count: number }> = []

  if (rosterDefaults?.starter_slots) {
    for (const [slotName, count] of Object.entries(rosterDefaults.starter_slots)) {
      if (typeof count !== 'number' || count <= 0) continue
      if (IDP_POSITION_SET.has(slotName.toUpperCase()) || slotName.toUpperCase() === 'IDP_FLEX') {
        idpSlots.push({ slotName, count })
      } else {
        offenseSlots.push({ slotName, count })
      }
    }
  }

  return optimizeIdpBestBallLineup(players, offenseSlots, idpSlots, positionMode)
}
