/**
 * Autopick's last-chance guard for starting lineups.
 *
 * With an empty queue, autopick takes the best-ranked player left, which ignores the roster: the MLB
 * Survivor rehearsal (2026-10-28) drafted 176 pitchers for 80 pitcher slots, only 16 first basemen
 * for 20 teams, and left 43 of 260 starting spots empty for the whole season. Best available stays
 * the rule while a team can still fill its starters later; once the team's remaining picks only just
 * cover its open starting spots, autopick takes only players who can start in one of them.
 */

export type StarterSlotNeed = { slotName: string; allowedPositions: string[]; count: number }

type TemplateSlot = { slotName?: string | null; allowedPositions?: readonly string[] | null; starterCount?: number | null }

const POSITION_SPLIT = /[\s,;/|-]+/

function positionsOf(position: string): string[] {
  return position.toUpperCase().split(POSITION_SPLIT).filter(Boolean)
}

/** The template's starting slots (bench, reserve, taxi and devy carry no starterCount). */
export function starterSlotsFromTemplate(slots: readonly TemplateSlot[]): StarterSlotNeed[] {
  return slots
    .filter((slot) => (slot.starterCount ?? 0) > 0 && (slot.allowedPositions?.length ?? 0) > 0)
    .map((slot) => ({
      slotName: String(slot.slotName ?? '').toUpperCase(),
      allowedPositions: (slot.allowedPositions ?? []).map((p) => p.toUpperCase()),
      count: slot.starterCount ?? 0,
    }))
}

function fits(position: string, slot: StarterSlotNeed): boolean {
  return positionsOf(position).some((p) => slot.allowedPositions.includes(p))
}

/**
 * The starting slots still open after seating the team's picks. Each pick takes the most restrictive
 * open slot it fits, players with the fewest options seated first, so a utility slot is left for
 * whoever can only play there.
 */
export function openStarterSlots(slots: readonly StarterSlotNeed[], ownPositions: readonly string[]): StarterSlotNeed[] {
  const open = slots.map((slot) => ({ ...slot }))
  const options = (position: string) => open.filter((slot) => slot.count > 0 && fits(position, slot))
  const players = [...ownPositions].sort((a, b) => options(a).length - options(b).length)
  for (const position of players) {
    const slot = options(position).sort((a, b) => a.allowedPositions.length - b.allowedPositions.length)[0]
    if (slot) slot.count -= 1
  }
  return open.filter((slot) => slot.count > 0)
}

/** True when this pick and every later one are needed to fill the team's open starting spots. */
export function mustFillStarter(open: readonly StarterSlotNeed[], picksLeftIncludingThis: number): boolean {
  const openCount = open.reduce((sum, slot) => sum + slot.count, 0)
  return openCount > 0 && openCount >= picksLeftIncludingThis
}

export function fitsOpenStarterSlot(position: string, open: readonly StarterSlotNeed[]): boolean {
  return open.some((slot) => fits(position, slot))
}
