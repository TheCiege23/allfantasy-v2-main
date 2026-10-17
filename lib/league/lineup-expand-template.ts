import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import { normalizePositionForStarterEligibility } from '@/lib/roster/LineupTemplateValidation'

export type ExpandedStarterSlot = {
  index: number
  label: string
  allowedPositions: string[]
  isFlexible: boolean
}

/**
 * Flatten template slots into one entry per starter position (QB, RB1, RB2, FLEX, …).
 */
export function expandStarterSlots(template: RosterTemplateDto): ExpandedStarterSlot[] {
  const sorted = [...template.slots].sort((a, b) => a.slotOrder - b.slotOrder)
  const out: ExpandedStarterSlot[] = []
  let idx = 0
  for (const slot of sorted) {
    const n = Math.max(0, slot.starterCount ?? 0)
    const countInTemplate = sorted.filter((s) => s.slotName === slot.slotName).reduce((s, x) => s + (x.starterCount ?? 0), 0)
    for (let i = 0; i < n; i++) {
      const label =
        n > 1 || countInTemplate > 1 ? `${slot.slotName}${i + 1}` : slot.slotName
      out.push({
        index: idx++,
        label,
        allowedPositions: [...(slot.allowedPositions ?? [])],
        isFlexible: Boolean(slot.isFlexibleSlot),
      })
    }
  }
  return out
}

/**
 * Can a player with this position fill this starting slot? An unknown position is not blocked here — the
 * lineup engine's template check has the final say — so a missing position never strands a player.
 */
export function fitsSlot(slot: Pick<ExpandedStarterSlot, 'allowedPositions'>, position: string | null): boolean {
  const allowed = slot.allowedPositions.map((p) => normalizePositionForStarterEligibility(String(p)))
  if (allowed.length === 0 || allowed.includes('*')) return true
  const pos = normalizePositionForStarterEligibility(String(position ?? ''))
  if (!pos || pos === 'UTIL' || pos === 'UNK') return true
  return allowed.includes(pos)
}
