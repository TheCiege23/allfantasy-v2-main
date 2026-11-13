/**
 * Assign draft picks to lineup sections using a sport-aware roster template.
 *
 * Called from `finalizeRosterAssignments()` on draft completion so that every
 * roster has a structured `lineup_sections` (and legacy `starters` array) that
 * the weekly scoring engine can read. Without this step, `playerData.starters`
 * is undefined and `extractStarterIds()` in `lib/scoring/scoring-engine.ts`
 * returns an empty list — scoring all rosters at 0 points.
 *
 * Algorithm: greedy pass in draft order. For each pick, place in the first
 * empty starter slot whose `allowedPositions` covers the pick's (normalized)
 * position. Remaining picks go to bench. We do NOT populate IR / taxi / devy
 * here — those are roster-management lists filled after the draft.
 */

import { normalizePositionForStarterEligibility } from '@/lib/roster/LineupTemplateValidation'
import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'

export interface DraftPickForLineup {
  playerId: string | null
  playerName: string
  position: string
  team?: string | null
}

type StarterSlotInstance = {
  slot: RosterTemplateSlotDto
  filled: DraftPickForLineup | null
}

interface LineupSectionsFromPicks {
  starters: Array<Record<string, unknown>>
  bench: Array<Record<string, unknown>>
  ir: Array<Record<string, unknown>>
  taxi: Array<Record<string, unknown>>
  devy: Array<Record<string, unknown>>
}

function expandStarterSlots(template: RosterTemplateDto): StarterSlotInstance[] {
  const sorted = template.slots
    .slice()
    .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))
  const instances: StarterSlotInstance[] = []
  for (const slot of sorted) {
    const count = Math.max(0, slot.starterCount ?? 0)
    for (let i = 0; i < count; i += 1) {
      instances.push({ slot, filled: null })
    }
  }
  // Flex / multi-position slots get placed LAST so exact-match slots are filled
  // first and flex capacity is preserved for spillover picks.
  instances.sort((a, b) => {
    const aFlex = a.slot.isFlexibleSlot || (a.slot.allowedPositions?.length ?? 0) > 1
    const bFlex = b.slot.isFlexibleSlot || (b.slot.allowedPositions?.length ?? 0) > 1
    if (aFlex === bFlex) return 0
    return aFlex ? 1 : -1
  })
  return instances
}

function slotAcceptsPosition(slot: RosterTemplateSlotDto, position: string): boolean {
  const normalized = normalizePositionForStarterEligibility(position)
  if (!normalized) return false
  const allowed = slot.allowedPositions ?? []
  if (allowed.length === 0) return true
  return allowed.some((p) => normalizePositionForStarterEligibility(String(p)) === normalized)
}

function toLineupRecord(pick: DraftPickForLineup): Record<string, unknown> {
  const id = (pick.playerId ?? '').trim()
  return {
    id,
    name: pick.playerName,
    position: String(pick.position || 'UTIL').toUpperCase(),
    team: pick.team ?? null,
  }
}

/**
 * Main entry point. `picks` MUST be in draft order (lowest overall first).
 * Picks with no `playerId` (rare, e.g. custom write-in) are skipped because
 * scoring needs a stable id.
 */
export function buildLineupSectionsFromPicks(
  picks: DraftPickForLineup[],
  template: RosterTemplateDto,
): LineupSectionsFromPicks {
  const placed = new Set<number>()
  const starterInstances = expandStarterSlots(template)
  const validPicks = picks.filter((p) => (p.playerId ?? '').trim().length > 0)

  for (let i = 0; i < validPicks.length; i += 1) {
    const pick = validPicks[i]!
    const idx = starterInstances.findIndex(
      (inst) => inst.filled === null && slotAcceptsPosition(inst.slot, pick.position),
    )
    if (idx >= 0) {
      starterInstances[idx]!.filled = pick
      placed.add(i)
    }
  }

  const starters = starterInstances
    .filter((inst): inst is StarterSlotInstance & { filled: DraftPickForLineup } => inst.filled !== null)
    .map((inst) => toLineupRecord(inst.filled))

  const bench = validPicks
    .map((pick, i) => (placed.has(i) ? null : pick))
    .filter((p): p is DraftPickForLineup => p !== null)
    .map(toLineupRecord)

  return {
    starters,
    bench,
    ir: [],
    taxi: [],
    devy: [],
  }
}
